--[[
	CharacterDriver: animates one character on this client.

	Every client animates every AAA character (players and NPCs) locally: locomotion is derived
	from the replicated physics (velocity, ground contact, facing) and replicated attributes
	(AAA_Armed, AAA_Crouch); one-shot actions arrive through the "Play"/"Stop" remotes. The local
	player's own driver is fed exact state by LocalController instead.

	Animation markers drive the cosmetic layer: footstep dust, dash bursts and afterimages,
	landing impacts, slash ribbons, blade glow, weapon draw/sheath. Gameplay listeners (hit
	detection for the local player) subscribe with driver:on(fn).
]]

local Players = game:GetService("Players")

local AAAMotion = game:GetService("ReplicatedStorage"):WaitForChild("AAAMotion")
local CharacterAnimator = require(AAAMotion.Animation.CharacterAnimator)
local ClipLibrary = require(AAAMotion.Animation.ClipLibrary)
local RigBinding = require(AAAMotion.Animation.RigBinding)
local Weapon = require(AAAMotion.Combat.Weapon)
local Effects = require(AAAMotion.VFX.Effects)
local Particles = require(AAAMotion.VFX.Particles)
local SwingRibbon = require(AAAMotion.VFX.SwingRibbon)
local Afterimage = require(AAAMotion.VFX.Afterimage)
local CameraFX = require(AAAMotion.VFX.CameraFX)
local Config = require(AAAMotion.Config)
local Util = require(AAAMotion.Util)
local Rig = require(AAAMotion.Generated.Rig)
local Tuning = require(AAAMotion.Generated.Tuning)
local Recipes = require(AAAMotion.Generated.VFXRecipes)

local MOVE = Tuning.MOVE
local UP = Vector3.yAxis

local CharacterDriver = {}
CharacterDriver.__index = CharacterDriver

local function isHeavySwing(kind: string?): boolean
	return kind ~= nil and (string.find(kind, "Spin") ~= nil or string.find(kind, "Overhead") ~= nil or string.find(kind, "Thrust") ~= nil)
end

function CharacterDriver.new(model: Model, isLocal: boolean)
	local self = setmetatable({}, CharacterDriver)
	self.model = model
	self.isLocal = isLocal
	self.player = Players:GetPlayerFromCharacter(model)
	self.humanoid = model:FindFirstChildOfClass("Humanoid") :: Humanoid
	self.root = model:FindFirstChild("HumanoidRootPart") :: BasePart
	self.anim = CharacterAnimator.new(Rig.R15)
	-- Attacks move the body planar-only (gravity keeps it grounded), so hops in their root
	-- motion (Light3's launcher, Light4's spin, the heavy leap) are shown by lifting the pelvis.
	self.anim.visualLift = true
	self.binding = RigBinding.new(model, Rig.R15)
	self.posScale = self.binding.posScale
	self.listeners = {}
	self.playListeners = {}
	self.state = { speed = 0, vy = 0, grounded = true, crouch = false, armed = false, yaw = 0 }
	self.external = false
	self.mode = "normal" -- normal | flight | down
	self.modeT = 0
	self.glow = 0.35
	self.glowTarget = 0.35
	self.flashT = 0
	self.afterimageT = 0
	self.fpHidden = false
	self.lastGroundY = self.root.Position.Y
	self.rayParams = RaycastParams.new()
	self.rayParams.FilterType = Enum.RaycastFilterType.Exclude
	self.rayParams.FilterDescendantsInstances = { model, Weapon.localFolder() }
	self.rayParams.RespectCanCollide = true

	self.weapon = Weapon.new({ scabbard = true, name = model.Name .. "_Katana" })
	self.armed = model:GetAttribute("AAA_Armed") == true
	self.weapon:attach(model, if self.armed then "hand" else "sheath", self.posScale)
	self.state.armed = self.armed
	if Config.Graphics.ribbonMode == "Trail" then
		self:buildTrails()
	end

	self.anim:on(function(name, data, track)
		self:onEvent(name, data, track)
	end)
	self.connections = {
		model:GetAttributeChangedSignal("AAA_Armed"):Connect(function()
			if not self.external then
				self.armed = model:GetAttribute("AAA_Armed") == true
			end
		end),
	}
	return self
end

function CharacterDriver:on(fn)
	table.insert(self.listeners, fn)
end

function CharacterDriver:destroy()
	for _, c in ipairs(self.connections) do
		c:Disconnect()
	end
	self.binding:reset()
	self.weapon:destroy()
	if self.highlight then
		self.highlight:Destroy()
	end
end

-- ------------------------------------------------------------------ helpers
function CharacterDriver:yawFrame(): CFrame
	local look = self.root.CFrame.LookVector
	return CFrame.Angles(0, Util.yawOf(Util.flat(look)), 0)
end

function CharacterDriver:feetPos(): Vector3
	local hum = self.humanoid
	local h = hum.HipHeight + self.root.Size.Y / 2
	return self.root.Position - Vector3.new(0, h - 0.05, 0)
end

function CharacterDriver:partPos(name: string, offset: Vector3?): Vector3
	local p = self.model:FindFirstChild(name) :: BasePart?
	if not p then
		return self.root.Position
	end
	return p.CFrame:PointToWorldSpace(offset or Vector3.zero)
end

-- Distance-based scale for camera feedback caused by other characters.
function CharacterDriver:feedbackScale(): number
	if self.isLocal then
		return 1
	end
	local cam = workspace.CurrentCamera
	local d = (cam.CFrame.Position - self.root.Position).Magnitude
	return math.clamp(1 - d / 60, 0, 1) * 0.35
end

function CharacterDriver:play(name: string, opts)
	local track = self.anim:play(name, opts)
	if track then
		for _, fn in ipairs(self.playListeners) do
			fn(name, opts or {}, track)
		end
	end
	return track
end

-- Mirrors (the first-person viewmodel) follow every action this driver plays or stops.
function CharacterDriver:onPlay(fn)
	table.insert(self.playListeners, fn)
end

function CharacterDriver:stopAction(fade: number?)
	self.anim:stopAction(fade)
	for _, fn in ipairs(self.playListeners) do
		fn(nil, { fadeOut = fade }, nil)
	end
end

function CharacterDriver:flash(strength: number?)
	self.flashT = 0.14 * (strength or 1)
	if not self.highlight then
		local h = Instance.new("Highlight")
		h.Name = "AAAHitFlash"
		h.FillColor = Color3.new(1, 1, 1)
		h.OutlineTransparency = 1
		h.FillTransparency = 1
		h.DepthMode = Enum.HighlightDepthMode.Occluded
		h.Adornee = self.model
		h.Parent = Weapon.localFolder()
		self.highlight = h
	end
end

function CharacterDriver:buildTrails()
	local a = self.weapon.attachments
	local function trail(a0: Attachment, a1: Attachment, width: { number }, transparency: number, color: ColorSequence)
		local t = Instance.new("Trail")
		t.Attachment0 = a0
		t.Attachment1 = a1
		t.Lifetime = Recipes.RIBBON.life
		t.MinLength = 0.02
		t.FaceCamera = false
		t.LightEmission = 1
		t.LightInfluence = 0
		t.Color = color
		t.Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0, transparency),
			NumberSequenceKeypoint.new(1, 1),
		})
		t.WidthScale = NumberSequence.new({
			NumberSequenceKeypoint.new(0, width[1]),
			NumberSequenceKeypoint.new(1, width[2]),
		})
		t.Enabled = false
		t.Parent = self.weapon.handle
		return t
	end
	local R = Recipes.RIBBON
	self.trails = {
		trail(a.inner, a.tip, { 1, 0.35 }, 0.55, ColorSequence.new(Color3.fromHex(R.edgeColor), Color3.fromHex(R.tailColor))),
		trail(a.mid, a.tip, { 1, 0.2 }, 0.15, ColorSequence.new(Color3.fromHex(R.coreColor), Color3.fromHex(R.edgeColor))),
	}
end

function CharacterDriver:setTrails(on: boolean)
	if self.trails then
		for _, t in ipairs(self.trails) do
			t.Enabled = on
		end
	end
end

-- ------------------------------------------------------------------ marker events
function CharacterDriver:onEvent(name: string, data, track)
	local scale = self:feedbackScale()
	if name == "WeaponAttach" then
		if data.initial then
			local clip = track.clip
			if clip.name == "Draw" then
				self.weapon:attach(self.model, "sheath", self.posScale)
			elseif clip.name == "Sheath" or clip.data.group == "combat" then
				self.weapon:attach(self.model, "hand", self.posScale)
			end
		else
			self.weapon:attach(self.model, data.to, self.posScale)
			if data.to == "hand" then
				Effects.play("Glint", self.weapon:worldPoint("base"))
			end
		end
	elseif name == "Footstep" then
		-- Phase footsteps carry the speed; markers from actions (wall-run steps) always puff.
		if data.speed == nil or (data.speed > 19 and self.state.grounded) then
			Effects.play("Footstep", self:partPos((data.foot or "Left") .. "Foot", Vector3.new(0, -0.15, 0)))
		end
	elseif name == "WallKick" then
		local right = self.root.CFrame.RightVector
		local away = if track.clip.meta.wall == "Left" then right else -right
		Effects.play("WallKick", self:feetPos() + UP * 1.2 - away * 1.5, { normal = away })
	elseif name == "Stomp" then
		Particles.emit("FootDust", 6, self:partPos((data.foot or "Right") .. "Foot", Vector3.new(0, -0.15, 0)), { sizeScale = 1.2 })
		if scale > 0 then
			CameraFX.shake("Land", 0.5 * scale)
		end
	elseif name == "DoubleJumpBurst" then
		Effects.play("DoubleJump", self:feetPos() + UP * 0.6)
		if self.isLocal then
			CameraFX.fovKick(6, 0.3)
		end
	elseif name == "DashStart" then
		local dir = self.dashDir or self.root.CFrame.LookVector
		Effects.play("DashBurst", self.root.Position - UP * 0.6, { forward = -dir })
		self.afterimageT = 0
		self.dashing = { t = 0, air = track.clip.meta.dash == "Air" }
	elseif name == "DashBrake" then
		if self.state.grounded then
			Particles.emit("DustPuff", 6, self:feetPos(), { sizeScale = 0.8 })
		end
	elseif name == "SlideStart" then
		Effects.play("SlideStart", self:feetPos())
	elseif name == "HandPlant" then
		local hand = if data.hand == "Both" or data.hand == nil then "RightHand" else data.hand .. "Hand"
		Effects.play("HandPlant", self:partPos(hand, Vector3.new(0, -0.15, 0)))
	elseif name == "Land" then
		if data.strength == "heavy" then
			Effects.play("LandHeavy", self:feetPos())
			if scale > 0 then
				CameraFX.shake("Heavy", scale)
			end
		else
			Effects.play("Land", self:feetPos())
		end
	elseif name == "SwingStart" then
		self:startSwing(data, track)
	elseif name == "SwingEnd" then
		self.glowTarget = 0.35
		self:setTrails(false)
	elseif name == "HeavyImpact" or name == "SlamImpact" then
		local ground
		if name == "SlamImpact" then
			ground = self:feetPos() + self.root.CFrame.LookVector * 1.5
		else
			local tip = self.weapon:worldPoint("tip")
			ground = Vector3.new(tip.X, self:feetPos().Y, tip.Z)
		end
		Effects.play(name, ground)
		if scale > 0 then
			CameraFX.shake("Heavy", 1.2 * scale)
		end
		if self.isLocal then
			CameraFX.impactFrame(0.07)
			CameraFX.flash(0.35, "#dff6ff")
		end
	elseif name == "BodyImpact" then
		Effects.play("Land", self:feetPos())
		Particles.emit("DustPuff", 5, self:feetPos() + UP * 0.2, { sizeScale = 1.2 })
	elseif name == "KipUp" then
		Particles.emit("DustPuff", 4, self:feetPos(), { sizeScale = 0.8 })
	elseif name == "SheathClick" then
		Effects.play("Glint", self.weapon:worldPoint("base"))
	end
	for _, fn in ipairs(self.listeners) do
		fn(name, data, track)
	end
end

function CharacterDriver:startSwing(marker, track)
	self.glowTarget = 2.6
	self:setTrails(true)
	local clip = track.clip
	local swing = nil
	for _, s in ipairs(clip.swings or {}) do
		if math.abs(s.t0 - marker.t) < 1e-4 then
			swing = s
		end
	end
	if not swing or self.fpHidden then
		return
	end
	-- Start frame = where the clip's origin is now: root position minus the root motion so far.
	local yaw = self:yawFrame()
	local rm = ClipLibrary.samplePosition(clip, "RootMotion", track.time) or Vector3.zero
	if clip.meta.visualLift then
		-- The body was lifted visually, not moved: the clip origin stays on the ground.
		rm = Vector3.new(rm.X, 0, rm.Z)
	end
	local origin = self.root.Position - yaw:VectorToWorldSpace(rm * self.posScale)
	local frame = CFrame.new(origin) * yaw
	local clock = { t = track.time }
	local live = track
	SwingRibbon.start(swing, function()
		return frame
	end, function()
		if live and not live.done then
			clock.t = live.time
		else
			live = nil
		end
		return clock.t
	end, { heavy = isHeavySwing(swing.kind), scale = self.posScale })
	self.ribbonClock = clock
end

-- ------------------------------------------------------------------ knockback reactions
function CharacterDriver:launch()
	self.mode = "flight"
	self.modeT = 0
	self:play("Knockback", { fadeIn = 0.05 })
end

-- ------------------------------------------------------------------ per-frame
function CharacterDriver:setState(s)
	self.external = true
	for k, v in pairs(s) do
		self.state[k] = v
	end
	if s.armed ~= nil then
		self.armed = s.armed
	end
end

function CharacterDriver:sampleState(dt: number)
	local root = self.root
	local v = root.AssemblyLinearVelocity
	local st = self.state
	st.speed = Vector3.new(v.X, 0, v.Z).Magnitude
	st.vy = v.Y
	local expected = self.humanoid.HipHeight + root.Size.Y / 2
	local hit = workspace:Raycast(root.Position, Vector3.new(0, -(expected + 1.2), 0), self.rayParams)
	local grounded = hit ~= nil and (root.Position.Y - hit.Position.Y) <= expected + (if st.grounded then 0.6 else 0.25)
	st.grounded = grounded
	st.yaw = Util.yawOf(Util.flat(root.CFrame.LookVector))
	st.crouch = self.model:GetAttribute("AAA_Crouch") == true
	st.armed = self.armed
	-- Guard is state, not an event: late joiners and block-hit recoveries resume it.
	local blocking = self.model:GetAttribute("AAA_Blocking") == true
	local action = self.anim.action
	if blocking and self.mode == "normal" and not self.anim:actionActive() then
		self:play("Block", { fadeIn = 0.1 })
	elseif not blocking and action and not action.stopping and action.clip.name == "Block" then
		self:stopAction(0.15)
	end
end

function CharacterDriver:update(dt: number, timeScale: number)
	if not self.root.Parent then
		return
	end
	local adt = dt * timeScale
	if not self.external then
		self:sampleState(dt)
	end
	local st = self.state

	-- Knockback flight -> knockdown -> get up.
	if self.mode == "flight" then
		self.modeT += dt
		if math.floor((self.modeT - dt) * 40) ~= math.floor(self.modeT * 40) then
			local v = self.root.AssemblyLinearVelocity
			if v.Magnitude > 4 then
				Particles.emit("WindBurst", 1, self.root.Position, { dir = -v.Unit, alphaScale = 0.5 })
			end
		end
		if self.modeT > 0.15 and st.grounded and st.vy <= 2 then
			self.mode = "down"
			self.modeT = 0
			self:play("KnockdownLand", { fadeIn = 0.04, hold = true })
			local s = self:feedbackScale()
			if s > 0 then
				CameraFX.shake("Land", 0.6 * s)
			end
		end
	elseif self.mode == "down" then
		self.modeT += dt
		if self.modeT > 0.75 and not self.gettingUp then
			self.gettingUp = true
			self:play("GetUp", { fadeIn = 0.06 })
		end
		if self.modeT > 1.75 then
			self.mode = "normal"
			self.gettingUp = false
		end
	end

	-- Root-motion actions move the body themselves; locomotion underneath should idle.
	local action = self.anim.action
	local rootMotion = action ~= nil and not action.stopping and action.clip.owns.RootMotion == true
	local locoSpeed = if self.mode ~= "normal" or rootMotion then 0 else st.speed
	self.anim.timeScale = timeScale
	self.anim:update(dt, {
		speed = locoSpeed,
		vy = st.vy,
		grounded = st.grounded,
		crouch = st.crouch,
		armed = st.armed,
		yaw = st.yaw,
	})
	local moving = st.grounded and st.speed > 3 and not self.anim:actionActive()
	if st.armed and moving then
		self.anim:setOverlay(if st.speed > 12 then "ArmedRun" else "ArmedWalk", 0.2)
	else
		self.anim:setOverlay(nil, 0.2)
	end

	local pose = self.anim:evaluate()
	self.binding:apply(pose)
	self.weapon:applyPose(pose.Weapon)

	-- Dash afterimages.
	local d = self.dashing
	if d then
		d.t += adt
		local D = if d.air then MOVE.airDash else MOVE.dash
		if d.t >= D.duration * 0.95 then
			self.dashing = nil
		else
			self.afterimageT -= adt
			if self.afterimageT <= 0 and not self.fpHidden then
				local cam = workspace.CurrentCamera
				if (cam.CFrame.Position - self.root.Position).Magnitude < 160 then
					Afterimage.spawn(Afterimage.partsOf(self.model, self.weapon:parts()), if d.air
						then { life = 0.24, transparency = 0.74 }
						else { life = 0.32, transparency = 0.58 })
				end
				self.afterimageT = if d.air then 0.05 else MOVE.dash.afterimageInterval
			end
		end
	end

	-- Blade glow and hit flash.
	self.glow = Util.damp(self.glow, self.glowTarget, 18, adt)
	self.weapon:setGlow(self.glow)
	if self.flashT > 0 then
		self.flashT -= dt
		local f = math.max(0, self.flashT / 0.14)
		if self.highlight then
			self.highlight.FillTransparency = 1 - f * f * 0.6
		end
	end
end

-- First-person: hide the body (and its weapon) locally; the viewmodel takes over.
function CharacterDriver:setFirstPerson(on: boolean)
	self.fpHidden = on
	local t = if on then 1 else 0
	for _, d in ipairs(self.model:GetDescendants()) do
		if d:IsA("BasePart") then
			d.LocalTransparencyModifier = t
		elseif d:IsA("Decal") then
			d.LocalTransparencyModifier = t
		end
	end
	self.weapon:setLocalTransparency(t)
end

return CharacterDriver
