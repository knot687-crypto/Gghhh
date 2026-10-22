--[[
	CharacterAnimator: drives an AnimationPlayer from gameplay state.
	Mirror of tools/anim/core/character.mjs (keep the two in sync).

	Layers: 0 locomotion (speed blended, phase synced) | 1 full-body actions | 2 upper-body overlay
	| 3 additive (flinches, landings). After blending, a procedural pass adds lean into turns and
	acceleration (pivoting at the feet) and hit-stop jitter.

	Usage:
		local anim = CharacterAnimator.new(Rig.R15)
		anim:on(function(name, data, track) ... end)   -- markers + Footstep events
		anim:update(dt, { speed =, vy =, grounded =, crouch =, armed =, yaw = })
		local pose = anim:evaluate()                   -- joint -> CFrame
]]

local AnimationPlayer = require(script.Parent.AnimationPlayer)
local ClipLibrary = require(script.Parent.ClipLibrary)

local LAYER = { LOCO = 0, ACTION = 1, OVERLAY = 2, ADDITIVE = 3 }

local LOCO_SETS = {
	sheathed = { idle = "Idle", moving = { { "Walk", 6 }, { "Run", 16 }, { "Sprint", 26 } } },
	armed = { idle = "CombatIdle", moving = { { "Walk", 6 }, { "Run", 16 }, { "Sprint", 26 } } },
	crouch = { idle = "CrouchIdle", moving = { { "CrouchWalk", 8 } } },
}

local LOCO_CLIPS = { "Idle", "Walk", "Run", "Sprint", "CombatIdle", "CrouchIdle", "CrouchWalk", "Rise", "Fall" }

local rad = math.rad

-- Critically damped spring step (stable for any dt). Returns position, velocity.
local function damp(cur: number, vel: number, target: number, halfLife: number, dt: number): (number, number)
	local omega = 1.386 / math.max(halfLife, 1e-4)
	local x = omega * dt
	local exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
	local change = cur - target
	local temp = (vel + omega * change) * dt
	local newVel = (vel - omega * temp) * exp
	return target + (change + temp) * exp, newVel
end

local function jointNames(rig)
	local names = {}
	for _, j in ipairs(rig.joints) do
		table.insert(names, j.name)
	end
	for _, v in ipairs(rig.virtualJoints or {}) do
		table.insert(names, v)
	end
	return names
end

local CharacterAnimator = {}
CharacterAnimator.__index = CharacterAnimator
CharacterAnimator.LAYER = LAYER
CharacterAnimator.LOCO_SETS = LOCO_SETS

function CharacterAnimator.new(rig)
	local self = setmetatable({}, CharacterAnimator)
	self.player = AnimationPlayer.new(jointNames(rig))
	self.loco = {}
	self.phase = 0
	self.action = nil
	self.overlay = nil
	self.listeners = {}
	self.timeScale = 1
	self.freeze = 0
	self.freezeShake = 0
	self.shakeSeed = 1
	self.lean = { roll = 0, rollV = 0, pitch = 0, pitchV = 0 }
	self.prevYaw = nil
	self.prevSpeed = 0
	self.legLength = 1.83
	self.wasGrounded = true
	self.state = { speed = 0, vy = 0, grounded = true, crouch = false, armed = false, yaw = 0 }
	self.player:onMarker(function(track, marker)
		self:emit(marker.name, marker, track)
	end)
	for _, name in ipairs(LOCO_CLIPS) do
		local clip = ClipLibrary.get(name)
		if clip then
			local tr = self.player:play(clip, { layer = LAYER.LOCO, weight = 0, fadeIn = 0, speed = 0, loop = true })
			tr.weight = 0
			tr.targetWeight = 0
			self.loco[name] = tr
		end
	end
	return self
end

function CharacterAnimator:on(fn)
	table.insert(self.listeners, fn)
end

function CharacterAnimator:emit(name: string, data, track)
	for _, fn in ipairs(self.listeners) do
		fn(name, data, track)
	end
end

-- ---------------------------------------------------------------- actions
function CharacterAnimator:play(name: string, opts)
	local clip = ClipLibrary.get(name)
	if not clip then
		warn("[AAAMotion] unknown clip", name)
		return nil
	end
	local o = opts or {}
	local layer = o.layer
		or (if clip.additive then LAYER.ADDITIVE elseif clip.meta.overlay then LAYER.OVERLAY else LAYER.ACTION)
	if layer == LAYER.ACTION and self.action and not self.action.stopping then
		self.action:stop(o.fadeIn or 0.08)
	end
	local track = self.player:play(clip, {
		layer = layer,
		fadeIn = o.fadeIn or (if layer == LAYER.ADDITIVE then 0.02 else 0.08),
		fadeOut = o.fadeOut or 0.15,
		speed = o.speed or 1,
		hold = o.hold or false,
		loop = o.loop,
		weight = o.weight or 1,
		mask = o.mask,
	})
	if layer == LAYER.ACTION then
		self.action = track
	end
	if clip.meta.weapon then
		self:emit("WeaponAttach", { to = clip.meta.weapon, initial = true }, track)
	end
	return track
end

function CharacterAnimator:stopAction(fade: number?)
	if self.action then
		self.action:stop(fade or 0.15)
	end
	self.action = nil
end

function CharacterAnimator:setOverlay(name: string?, fade: number?)
	local f = fade or 0.2
	if self.overlay and name and self.overlay.clip.name == name and not self.overlay.stopping then
		return
	end
	if self.overlay then
		self.overlay:stop(f)
	end
	self.overlay = nil
	if name then
		local clip = ClipLibrary.get(name)
		if clip then
			self.overlay = self.player:play(clip, { layer = LAYER.OVERLAY, fadeIn = f, loop = true })
		end
	end
end

function CharacterAnimator:hitStop(duration: number, shake: number?)
	self.freeze = math.max(self.freeze, duration)
	self.freezeShake = shake or 0
end

function CharacterAnimator:actionActive(): boolean
	local a = self.action
	return a ~= nil and not a.stopping and not a.done
end

-- ---------------------------------------------------------------- locomotion
function CharacterAnimator:locoWeights(s)
	local w = {}
	for n in pairs(self.loco) do
		w[n] = 0
	end
	if not s.grounded then
		local rise = math.clamp((s.vy + 6) / 18, 0, 1)
		w.Rise = rise
		w.Fall = 1 - rise
		return w
	end
	local set = if s.crouch then LOCO_SETS.crouch elseif s.armed then LOCO_SETS.armed else LOCO_SETS.sheathed
	local pts = { { set.idle, 0 } }
	for _, m in ipairs(set.moving) do
		table.insert(pts, m)
	end
	local v = s.speed
	if v <= 0.25 then
		w[set.idle] = 1
		return w
	end
	for i = 1, #pts - 1 do
		local a, va = pts[i][1], pts[i][2]
		local b, vb = pts[i + 1][1], pts[i + 1][2]
		if v <= vb then
			local k = math.clamp((v - va) / (vb - va), 0, 1)
			w[a] = (w[a] or 0) + 1 - k
			w[b] = (w[b] or 0) + k
			return w
		end
	end
	w[pts[#pts][1]] = 1
	return w
end

function CharacterAnimator:update(dt: number, s)
	local st = self.state
	for k, v in pairs(s) do
		st[k] = v
	end
	local adt = dt * self.timeScale
	if self.freeze > 0 then
		self.freeze -= dt
		adt *= 0.02
	end

	local w = self:locoWeights(st)
	local fade = if st.grounded ~= self.wasGrounded then 0.12 else 0.18
	self.wasGrounded = st.grounded
	for n, tr in pairs(self.loco) do
		if tr.targetWeight ~= w[n] then
			tr:fadeTo(w[n] or 0, fade)
		end
	end

	-- Phase sync: advance by distance travelled / blended stride.
	local strideW, stride = 0, 0
	for n, tr in pairs(self.loco) do
		local s_ = tr.clip.meta.stride
		if s_ and (w[n] or 0) > 0 then
			stride += s_ * w[n]
			strideW += w[n]
		end
	end
	local walk = ClipLibrary.get("Walk")
	local blended = if strideW > 0 then stride / strideW else (walk and walk.meta.stride or 5)
	local prevPhase = self.phase
	if st.grounded then
		self.phase = (self.phase + (adt * st.speed) / blended) % 1
	end
	if strideW > 0.4 and st.grounded then
		if prevPhase > self.phase then
			self:emit("Footstep", { foot = "Left", speed = st.speed })
		elseif prevPhase < 0.5 and self.phase >= 0.5 then
			self:emit("Footstep", { foot = "Right", speed = st.speed })
		end
	end
	for _, tr in pairs(self.loco) do
		if tr.clip.meta.stride then
			tr.speed = 0
			tr.time = self.phase * tr.clip.length
		else
			tr.speed = 1
		end
	end
	if self.overlay and self.overlay.clip.meta.syncWith then
		self.overlay.speed = 0
		self.overlay.time = self.phase * self.overlay.clip.length
	end

	self.player:update(adt)
	if self.action and self.action.done then
		self.action = nil
	end

	-- Lean: roll into turns (centripetal), pitch with acceleration.
	if self.prevYaw == nil then
		self.prevYaw = st.yaw
	end
	local dy = st.yaw - self.prevYaw
	dy = math.atan2(math.sin(dy), math.cos(dy))
	self.prevYaw = st.yaw
	local yawRate = if dt > 0 then dy / dt else 0
	local accel = if dt > 0 then (st.speed - self.prevSpeed) / dt else 0
	self.prevSpeed = st.speed
	local leanScale = if st.grounded and not self:actionActive() then 1 else 0.25
	local rollTarget = math.clamp(yawRate * st.speed * 0.55, -16, 16) * leanScale
	local pitchTarget = math.clamp(-accel * 0.22, -9, 6) * leanScale
	self.lean.roll, self.lean.rollV = damp(self.lean.roll, self.lean.rollV, rollTarget, 0.12, dt)
	self.lean.pitch, self.lean.pitchV = damp(self.lean.pitch, self.lean.pitchV, pitchTarget, 0.1, dt)
end

function CharacterAnimator:evaluate()
	local pose = self.player:evaluate()
	local root = pose.Root
	if root then
		-- Lean about the ground point under the root joint so the feet stay put.
		local q = CFrame.Angles(rad(self.lean.pitch), 0, rad(self.lean.roll))
		local c = Vector3.new(0, -self.legLength, 0)
		local lean = CFrame.new(c - q:VectorToWorldSpace(c)) * q
		root = lean * root
		if self.freeze > 0 and self.freezeShake > 0 then
			self.shakeSeed = (self.shakeSeed * 16807) % 2147483647
			local r1 = self.shakeSeed / 2147483647 - 0.5
			self.shakeSeed = (self.shakeSeed * 16807) % 2147483647
			local r2 = self.shakeSeed / 2147483647 - 0.5
			root = CFrame.new(r1 * self.freezeShake, 0, r2 * self.freezeShake) * root
		end
		pose.Root = root
	end
	return pose
end

return CharacterAnimator
