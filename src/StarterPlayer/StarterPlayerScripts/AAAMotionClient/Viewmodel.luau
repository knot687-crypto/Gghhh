--[[
	First-person viewmodel (Roblox twin of the preview's viewmodel.js).

	A slim arms rig (Generated/Rig.VM) parented to the camera plays the FP_* clips. Every action
	the local character plays is mirrored onto its FP_ counterpart, so first and third person
	stay in lockstep (attack clips share lengths and marker times). The clips' virtual "Camera"
	joint drives camera kick, dip and roll; procedural bob, sway and strafe roll sit on top.
]]

local AAAMotion = game:GetService("ReplicatedStorage"):WaitForChild("AAAMotion")
local AnimationPlayer = require(AAAMotion.Animation.AnimationPlayer)
local ClipLibrary = require(AAAMotion.Animation.ClipLibrary)
local Weapon = require(AAAMotion.Combat.Weapon)
local SwingRibbon = require(AAAMotion.VFX.SwingRibbon)
local Util = require(AAAMotion.Util)
local Rig = require(AAAMotion.Generated.Rig)
local Tuning = require(AAAMotion.Generated.Tuning)

local VM = Rig.VM
local MOVE = Tuning.MOVE

local JACKET = Color3.fromHex("#34466f")
local GLOVES = Color3.fromHex("#2a2d35")

local IDENTITY = CFrame.identity

local Viewmodel = {}
Viewmodel.__index = Viewmodel

local function alias(name: string): string?
	if string.match(name, "^Dash") or name == "AirDash" then
		return "FP_Dash"
	elseif name == "LandLight" or name == "LandHeavy" or name == "LandRoll" then
		return "FP_Land"
	elseif name == "Parried" or name == "GuardBreak" then
		return "FP_BlockHit"
	end
	local fp = "FP_" .. name
	return if ClipLibrary.get(fp) then fp else nil
end

function Viewmodel.new(driver)
	local self = setmetatable({}, Viewmodel)
	self.driver = driver
	self.enabled = false

	local model = Instance.new("Model")
	model.Name = "AAAViewmodel"
	self.model = model
	local parts = {}
	for name, size in pairs(VM.parts) do
		local p = Instance.new("Part")
		p.Name = name
		p.Size = Vector3.new(size[1], size[2], size[3])
		p.Anchored = name == VM.root
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.Massless = true
		p.CastShadow = false
		p.Material = Enum.Material.SmoothPlastic
		p.TopSurface = Enum.SurfaceType.Smooth
		p.BottomSurface = Enum.SurfaceType.Smooth
		p.Color = if string.find(name, "Hand") then GLOVES else JACKET
		if name == VM.root or name == "UpperTorso" then
			p.Transparency = 1
		end
		p.Parent = model
		parts[name] = p
	end
	model.PrimaryPart = parts[VM.root]
	self.parts = parts

	-- Joints: C0 is rewritten every frame as baseC0 * pose (anchored root, render-time update).
	self.joints = {}
	local names = {}
	for _, j in ipairs(VM.joints) do
		table.insert(names, j.name)
		if j.name ~= "Weapon" then
			local m = Instance.new("Motor6D")
			m.Name = j.name
			m.Part0 = parts[j.part0]
			m.Part1 = parts[j.part1]
			local c0 = Util.cframe(j.c0, j.c0r)
			m.C0 = c0
			m.C1 = Util.cframe(j.c1, j.c1r)
			m.Parent = parts[j.part1]
			self.joints[j.name] = { motor = m, c0 = c0 }
		else
			self.weaponC0 = Util.cframe(j.c0, j.c0r)
		end
	end
	for _, v in ipairs(VM.virtualJoints or {}) do
		table.insert(names, v)
	end

	self.weapon = Weapon.new({ scale = Weapon.VM_SCALE, parent = model, name = "VMKatana" })
	self.weapon:attachToPart(parts.RightHand, self.weaponC0)
	for _, d in ipairs(self.weapon.model:GetDescendants()) do
		if d:IsA("BasePart") then
			d.CastShadow = false
		end
	end

	self.anim = AnimationPlayer.new(names)
	self.idle = self.anim:play(ClipLibrary.get("FP_Idle"), { layer = 0, fadeIn = 0 })
	self.sprint = self.anim:play(ClipLibrary.get("FP_Sprint"), { layer = 0, fadeIn = 0, weight = 0, speed = 0 })
	self.sprint.weight = 0
	self.sprint.targetWeight = 0
	self.action = nil
	self.bob = 0
	self.sway = { x = 0, y = 0, roll = 0 }
	self.prevYaw = nil
	self.prevPitch = nil
	self.cam = IDENTITY
	self.pose = {}
	self.glow = 0.35
	self.glowTarget = 0.35

	driver:onPlay(function(name, opts, track)
		self:mirror(name, opts, track)
	end)
	self.anim:onMarker(function(track, m)
		self:onMarker(track, m)
	end)
	return self
end

function Viewmodel:setEnabled(on: boolean)
	self.enabled = on
	self.model.Parent = if on then workspace.CurrentCamera else nil
end

function Viewmodel:mirror(name: string?, opts, _track)
	if name == nil then
		if self.action then
			self.action:stop(opts.fadeOut or 0.15)
			self.action = nil
		end
		return
	end
	-- The viewmodel only animates in first person; don't queue tracks that never update.
	local fpName = alias(name)
	if not fpName or not self.enabled then
		return
	end
	local clip = ClipLibrary.get(fpName)
	local layer = if clip.additive then 3 else 1
	if layer == 1 and self.action then
		self.action:stop(opts.fadeIn or 0.08)
	end
	local tr = self.anim:play(clip, {
		layer = layer,
		fadeIn = opts.fadeIn or 0.06,
		fadeOut = 0.15,
		speed = opts.speed or 1,
		hold = opts.hold or false,
	})
	if layer == 1 then
		self.action = tr
	end
end

function Viewmodel:onMarker(track, m)
	if m.name == "SwingStart" then
		self.glowTarget = 2.6
		if not self.enabled then
			return
		end
		local swing = nil
		for _, s in ipairs(track.clip.swings or {}) do
			if math.abs(s.t0 - m.t) < 1e-4 then
				swing = s
			end
		end
		if swing then
			local clock = { t = track.time }
			local root = self.parts[VM.root]
			SwingRibbon.start(swing, function()
				return root.CFrame
			end, function()
				if not track.done then
					clock.t = track.time
				end
				return clock.t
			end, { heavy = swing.kind ~= nil and (string.find(swing.kind, "Spin") or string.find(swing.kind, "Overhead") or string.find(swing.kind, "Thrust")) ~= nil })
		end
	elseif m.name == "SwingEnd" then
		self.glowTarget = 0.35
	end
end

function Viewmodel:actionActive(): boolean
	local a = self.action
	return a ~= nil and not a.stopping and not a.done
end

-- Advances the animation (call once per render frame before cameraCFrame).
function Viewmodel:update(dt: number, timeScale: number, ctrl)
	local d = self.driver
	local root = d.root
	local grounded = d.state.grounded and ctrl.mode ~= "Slide"
	local v = root.AssemblyLinearVelocity
	local speed = if grounded then Util.flat(v).Magnitude else 0
	local sprintW = if grounded and speed > 20 and not self:actionActive() then 1 else 0
	if self.sprint.targetWeight ~= sprintW then
		self.sprint:fadeTo(sprintW, 0.2)
	end
	if self.idle.targetWeight ~= 1 - sprintW then
		self.idle:fadeTo(1 - sprintW, 0.2)
	end
	local phase = d.anim.phase
	self.sprint.time = phase * self.sprint.clip.length
	local freeze = if d.anim.freeze > 0 then 0.02 else 1
	self.anim:update(dt * freeze * timeScale)
	if self.action and self.action.done then
		self.action = nil
	end

	-- Bob while moving, sway against camera turns, roll into strafes.
	local moving = grounded and speed > 2 and not self:actionActive()
	self.bob = Util.damp(self.bob, if moving then math.min(speed / MOVE.walkSpeed, 1.4) else 0, 10, dt)
	local yaw, pitch = ctrl.camera:getYaw(), ctrl.camera:getPitch()
	local yawRate = if self.prevYaw then Util.angleDiff(self.prevYaw, yaw) / math.max(dt, 1e-4) else 0
	local pitchRate = if self.prevPitch then (pitch - self.prevPitch) / math.max(dt, 1e-4) else 0
	self.prevYaw, self.prevPitch = yaw, pitch
	self.sway.x = Util.damp(self.sway.x, math.clamp(-yawRate * 0.012, -0.12, 0.12), 12, dt)
	self.sway.y = Util.damp(self.sway.y, math.clamp(-pitchRate * 0.01, -0.1, 0.1), 12, dt)
	local right = Util.rightOf(yaw)
	local strafe = v:Dot(right)
	self.sway.roll = Util.damp(self.sway.roll, math.clamp(-strafe * 0.12, -3, 3), 8, dt)
	local ph = phase * math.pi * 2
	self.bobOffset = Vector3.new(
		math.sin(ph) * 0.035 * self.bob + self.sway.x,
		-math.abs(math.cos(ph)) * 0.05 * self.bob + self.sway.y,
		0
	)
	self.bobCam = self.bob * 0.04 * math.abs(math.cos(ph))
	self.pose = self.anim:evaluate()
	self.cam = self.pose.Camera or IDENTITY
	self.glow = Util.damp(self.glow, self.glowTarget, 18, dt)
	self.weapon:setGlow(self.glow)
end

-- Places the arms for this frame and returns the camera CFrame (base = eye + look rotation).
function Viewmodel:cameraCFrame(base: CFrame, _dt: number): CFrame
	local cj = self.cam
	local rotOnly = base.Rotation
	-- Arms follow the camera joint's translation and 35% of its rotation, so big camera moves
	-- still read while the weapon stays framed.
	local partial = IDENTITY:Lerp(cj.Rotation, 0.35)
	local vmPos = base.Position + rotOnly:VectorToWorldSpace((self.bobOffset or Vector3.zero) + cj.Position)
	local rootCF = CFrame.new(vmPos) * rotOnly * partial
	if self.enabled then
		self.parts[VM.root].CFrame = rootCF
		for name, j in pairs(self.joints) do
			local t = self.pose[name]
			j.motor.C0 = if t then j.c0 * t else j.c0
		end
		local wt = self.pose.Weapon
		self.weapon.motor.C0 = if wt then self.weaponC0 * wt else self.weaponC0
	end
	local camCF = CFrame.new(base.Position + rotOnly:VectorToWorldSpace(cj.Position)) * rotOnly * cj.Rotation
	camCF *= CFrame.Angles(0, 0, math.rad(self.sway.roll))
	return camCF - Vector3.new(0, self.bobCam or 0, 0)
end

function Viewmodel:destroy()
	self.model:Destroy()
end

return Viewmodel
