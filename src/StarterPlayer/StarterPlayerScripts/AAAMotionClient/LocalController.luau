--[[
	LocalController: the local player's movement and combat state machine.

	Modes
		Ground    Humanoid walking (walk / sprint / crouch / block speeds)
		Air       jumping and falling (double jump, air dash, wall-run entry, ledge mantle)
		Dash      ground or air dash (LinearVelocity, eased speed profile, afterimages)
		Slide     sprint + crouch; friction-decayed slide, jump out keeps momentum
		WallRun   along a wall with reduced gravity; jump kicks off
		Action    clip-driven: attacks, vault, mantle, staggers (root motion servo + warping)
		Charge    heavy attack wind-up
		Aerial    plunging slam
		Flight / Down   knocked back by a hit, then knocked down and getting up

	Gameplay numbers come from Generated/Tuning (same values the preview videos use).
	Every action is played locally at once and replicated through the server to other clients.
]]

local UserInputService = game:GetService("UserInputService")

local AAAMotion = game:GetService("ReplicatedStorage"):WaitForChild("AAAMotion")
local ClipLibrary = require(AAAMotion.Animation.ClipLibrary)
local HitQuery = require(AAAMotion.Combat.HitQuery)
local Effects = require(AAAMotion.VFX.Effects)
local Particles = require(AAAMotion.VFX.Particles)
local CameraFX = require(AAAMotion.VFX.CameraFX)
local Config = require(AAAMotion.Config)
local Net = require(AAAMotion.Net)
local Util = require(AAAMotion.Util)
local Tuning = require(AAAMotion.Generated.Tuning)

local Drivers = require(script.Parent.Drivers)
local Motor = require(script.Parent.Motor)

local MOVE = Tuning.MOVE
local ATTACKS = Tuning.ATTACKS
local Y = Vector3.yAxis

local flat = Util.flat
local yawOf = Util.yawOf
local forwardOf = Util.forwardOf

local function smooth01(x: number): number
	local t = math.clamp(x, 0, 1)
	return t * t * (3 - 2 * t)
end

local function firstMarker(clip, name: string, default: number): number
	for _, m in ipairs(clip.markers) do
		if m.name == name then
			return m.t
		end
	end
	return default
end

local LocalController = {}
LocalController.__index = LocalController

function LocalController.new(driver, camera)
	local self = setmetatable({}, LocalController)
	self.driver = driver
	self.camera = camera
	self.model = driver.model
	self.humanoid = driver.humanoid :: Humanoid
	self.root = driver.root :: BasePart
	self.motor = Motor.new(self.model)
	self.posScale = driver.posScale

	self.mode = "Ground"
	self.t = 0
	self.armed = self.model:GetAttribute("AAA_Armed") == true
	self.crouch = false
	self.crouchHeld = false
	self.sprintHeld = false
	self.sprintToggle = false
	self.blocking = false
	self.cool = { dash = 0, slide = 0, wall = 0, lunge = 0, jump = 0 }
	self.airDashes = MOVE.dash.airDashes
	self.jumps = 0
	self.airTime = 0
	self.minAirVy = 0
	self.landLock = 0
	self.stunT = 0
	self.attackSeq = 0
	self.pending = {}
	self.predicted = {}
	self.grounded = true
	self.lastJumpPress = -1

	local hum = self.humanoid
	hum.UseJumpPower = true
	hum.JumpPower = MOVE.jumpVelocity
	hum.WalkSpeed = MOVE.walkSpeed
	hum:SetStateEnabled(Enum.HumanoidStateType.FallingDown, false)
	hum:SetStateEnabled(Enum.HumanoidStateType.Ragdoll, false)

	self.rayParams = RaycastParams.new()
	self.rayParams.FilterType = Enum.RaycastFilterType.Exclude
	self.rayParams.FilterDescendantsInstances = { self.model, require(AAAMotion.Combat.Weapon).localFolder() }
	self.rayParams.RespectCanCollide = true

	self.connections = {
		hum.StateChanged:Connect(function(_, new)
			if new == Enum.HumanoidStateType.Jumping and self.mode == "Ground" then
				self:onGroundJump()
			end
		end),
		UserInputService.JumpRequest:Connect(function()
			if not UserInputService.KeyboardEnabled and not UserInputService.GamepadEnabled then
				self.lastJumpPress = os.clock() -- touch: JumpRequest is the press
			end
			self:onJumpRequest()
		end),
		UserInputService.InputBegan:Connect(function(input, processed)
			if processed then
				return
			end
			if input.KeyCode == Enum.KeyCode.Space or input.KeyCode == Enum.KeyCode.ButtonA then
				self.lastJumpPress = os.clock()
				self:onJumpRequest()
			end
		end),
	}
	driver:setState({ armed = self.armed })
	driver:on(function(name, data, track)
		self:onAnimEvent(name, data, track)
	end)
	return self
end

function LocalController:destroy()
	for _, c in ipairs(self.connections) do
		c:Disconnect()
	end
	self.motor:destroy()
end

-- ------------------------------------------------------------------ utilities
function LocalController:ray(origin: Vector3, dir: Vector3): RaycastResult?
	return workspace:Raycast(origin, dir, self.rayParams)
end

function LocalController:rootHeight(): number
	return self.humanoid.HipHeight + self.root.Size.Y / 2
end

function LocalController:feetY(): number
	return self.root.Position.Y - self:rootHeight()
end

function LocalController:yaw(): number
	return yawOf(flat(self.root.CFrame.LookVector))
end

function LocalController:moveDir(): Vector3
	local m = flat(self.humanoid.MoveDirection)
	return if m.Magnitude > 0.05 then m.Unit else Vector3.zero
end

function LocalController:hSpeed(): number
	return flat(self.root.AssemblyLinearVelocity).Magnitude
end

function LocalController:isSprinting(): boolean
	return (self.sprintHeld or self.sprintToggle) and not self.crouch and not self.blocking
end

function LocalController:setMode(m: string)
	self.mode = m
	self.t = 0
	local canJump = m == "Ground" or m == "Air"
	self.humanoid:SetStateEnabled(Enum.HumanoidStateType.Jumping, canJump)
end

function LocalController:playReplicated(name: string, opts, extra)
	local track = self.driver:play(name, opts)
	local o = opts or {}
	Net.send("Play", name, {
		fadeIn = o.fadeIn,
		speed = o.speed,
		hold = o.hold,
		dir = extra and extra.dir or nil,
	})
	return track
end

function LocalController:stopReplicated(fade: number)
	self.driver:stopAction(fade)
	Net.send("Stop", fade)
end

function LocalController:setArmed(on: boolean)
	if self.armed == on then
		return
	end
	self.armed = on
	self.driver:setState({ armed = on })
	Net.send("State", { armed = on })
end

-- Soft aim: snap the attack toward the nearest enemy close to the camera direction.
function LocalController:aimYaw(): number
	local yaw = self.camera:getYaw()
	local fwd = forwardOf(yaw)
	local best, bestScore = nil, math.huge
	for _, c in ipairs(Drivers.candidates(self.model)) do
		local to = flat(c.root.Position - self.root.Position)
		local d = to.Magnitude
		if d > 0.1 and d < 14 then
			local cos = to.Unit:Dot(fwd)
			if cos > math.cos(math.rad(50)) then
				local score = d * (2 - cos)
				if score < bestScore then
					best, bestScore = to.Unit, score
				end
			end
		end
	end
	return if best then yawOf(best) else yaw
end

-- ------------------------------------------------------------------ input entry points
function LocalController:onAction(action: string, down: boolean)
	if action == "Sprint" then
		self.sprintHeld = down
		if down and UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled then
			self.sprintToggle = not self.sprintToggle
		end
	elseif action == "Crouch" then
		self.crouchHeld = down
		if down then
			if self.mode == "Ground" and self:isSprinting() and self:hSpeed() >= MOVE.slide.minSpeed and self:slide() then
				return
			end
			if self.mode == "Ground" then
				self:setCrouch(true)
			end
		elseif self.crouch then
			self:setCrouch(false)
		end
	elseif not down then
		if action == "Heavy" then
			self:releaseCharge()
		elseif action == "Block" then
			self:setBlock(false)
		end
	elseif action == "Dash" then
		self:dash()
	elseif action == "Light" then
		self:light()
	elseif action == "Heavy" then
		self:heavy()
	elseif action == "Block" then
		self:setBlock(true)
	elseif action == "Lunge" then
		self:lunge()
	elseif action == "Draw" then
		self:drawOrSheath()
	end
end

function LocalController:setCrouch(on: boolean)
	if self.crouch == on then
		return
	end
	self.crouch = on
	Net.send("State", { crouch = on })
end

-- ------------------------------------------------------------------ jumping
function LocalController:onGroundJump()
	self:setMode("Air")
	self.jumps = 1
	self.airTime = 0
	self.minAirVy = 0
	self:setCrouch(false)
	self:playReplicated("JumpStart", { fadeIn = 0.05 })
	Particles.emit("FootDust", 4, self.root.Position - Y * (self:rootHeight() - 0.05))
end

function LocalController:onJumpRequest()
	-- JumpRequest repeats while the button is held; only fresh presses trigger air actions.
	if self.cool.jump > 0 or os.clock() - self.lastJumpPress > 0.12 then
		return
	end
	local m = self.mode
	if m == "WallRun" then
		self.cool.jump = 0.2
		self:wallJump()
	elseif m == "Slide" then
		self.cool.jump = 0.2
		self:slideJump()
	elseif m == "Ground" then
		if self:tryMantle(false) then
			self.cool.jump = 0.2
		end
	elseif m == "Air" then
		if self.airTime < 0.06 then
			return -- the Humanoid's own jump is still leaving the ground
		end
		self.cool.jump = 0.2
		if self.jumps == 0 and self.airTime < MOVE.coyoteTime then
			self:coyoteJump()
		elseif self:tryMantle(false) then
			return
		elseif self.jumps < 2 then
			self:doubleJump()
		end
	end
end

function LocalController:coyoteJump()
	local v = self.root.AssemblyLinearVelocity
	self.root.AssemblyLinearVelocity = Vector3.new(v.X, MOVE.jumpVelocity, v.Z)
	self.jumps = 1
	self.minAirVy = 0
	self:playReplicated("JumpStart", { fadeIn = 0.05 })
end

function LocalController:doubleJump()
	local v = self.root.AssemblyLinearVelocity
	-- Let the second jump redirect momentum toward the stick.
	local input = self:moveDir()
	local h = flat(v)
	if input.Magnitude > 0 then
		h = input * math.max(h.Magnitude, MOVE.walkSpeed)
	end
	self.root.AssemblyLinearVelocity = h + Y * MOVE.doubleJumpVelocity
	self.jumps = 2
	self.minAirVy = 0
	self:playReplicated("DoubleJump", { fadeIn = 0.05 })
end

function LocalController:land()
	local impact = -self.minAirVy
	self.minAirVy = 0
	self.jumps = 0
	self.airDashes = MOVE.dash.airDashes
	self:setMode("Ground")
	local L = MOVE.land
	if impact > L.heavySpeed and self:hSpeed() > L.rollSpeed then
		self:playReplicated("LandRoll", { fadeIn = 0.04 })
	elseif impact > L.heavySpeed then
		self:playReplicated("LandHeavy", { fadeIn = 0.03 })
		self.landLock = 0.45
	elseif impact > L.lightSpeed then
		self:playReplicated("LandLight", { fadeIn = 0.02 })
	end
end

-- ------------------------------------------------------------------ dash
function LocalController:dash()
	if self.cool.dash > 0 or self.stunT > 0 then
		return
	end
	local m = self.mode
	if m ~= "Ground" and m ~= "Air" then
		return
	end
	local air = m == "Air"
	if air and self.airDashes <= 0 then
		return
	end
	if air then
		self.airDashes -= 1
	end
	if self.blocking then
		self:setBlock(false)
	end
	self:setCrouch(false)
	local input = self:moveDir()
	local camYaw = self.camera:getYaw()
	local dir = if input.Magnitude > 0 then input else forwardOf(camYaw)
	local clipName, faceYaw
	if air then
		clipName, faceYaw = "AirDash", yawOf(dir)
	elseif self.armed or self.camera:isFirstPerson() then
		-- Strafe dashes keep facing the camera.
		faceYaw = camYaw
		local f = dir:Dot(forwardOf(camYaw))
		local r = dir:Dot(Util.rightOf(camYaw))
		if math.abs(f) >= math.abs(r) then
			clipName = if f >= 0 then "DashForward" else "DashBack"
		else
			clipName = if r >= 0 then "DashRight" else "DashLeft"
		end
	else
		clipName, faceYaw = "DashForward", yawOf(dir)
	end
	self:setMode("Dash")
	self.dashState = { dir = dir, air = air, vy = MOVE.airDash.upVelocity }
	self.cool.dash = MOVE.dash.cooldown
	self.motor:face(faceYaw, 250)
	self.driver.dashDir = dir
	self:playReplicated(clipName, { fadeIn = 0.04 }, { dir = dir })
	CameraFX.fovKick(10, 0.35)
end

function LocalController:stepDash(dt: number)
	local d = self.dashState
	local D = if d.air then MOVE.airDash else MOVE.dash
	local k = math.min(self.t / D.duration, 1)
	local sp = D.speed + (MOVE.dash.endSpeed - D.speed) * (1 - (1 - k) ^ 2)
	if d.air then
		d.vy -= MOVE.gravity * 0.25 * dt
		self.motor:vector(d.dir * sp + Y * d.vy)
	else
		self.motor:planar(d.dir * sp)
	end
	if k >= 1 then
		self.motor:release()
		self.motor:freeFacing()
		if d.air then
			self:setMode("Air")
		else
			self.root.AssemblyLinearVelocity = d.dir * MOVE.dash.endSpeed * 0.55
			self:setMode("Ground")
		end
	end
end

-- ------------------------------------------------------------------ slide
function LocalController:slide(): boolean
	if self.mode ~= "Ground" or self.cool.slide > 0 then
		return false
	end
	local v = flat(self.root.AssemblyLinearVelocity)
	if v.Magnitude < MOVE.slide.minSpeed then
		return false
	end
	self:setMode("Slide")
	self.slideState = { dir = v.Unit, speed = math.max(v.Magnitude, MOVE.slide.boost), looped = false }
	self.motor:face(yawOf(v.Unit), 250)
	self:playReplicated("SlideEnter", { fadeIn = 0.05, hold = true })
	CameraFX.fovKick(6, 0.45)
	return true
end

function LocalController:stepSlide(dt: number, grounded: boolean)
	local s = self.slideState
	s.speed = math.max(0, s.speed - MOVE.slide.friction * dt)
	self.motor:planar(s.dir * s.speed)
	if not s.looped and self.t >= 0.24 then
		s.looped = true
		self:playReplicated("Slide", { fadeIn = 0.1 })
	end
	if math.floor((self.t - dt) * 30) ~= math.floor(self.t * 30) then
		local foot = self.driver:partPos("LeftFoot", Vector3.new(0, -0.15, -0.5))
		Particles.emit("SlideSparks", 2, foot, { dir = (-s.dir + Y * 0.6).Unit })
		Particles.emit("FootDust", 1, foot, { sizeScale = 1.1 })
	end
	if s.speed < MOVE.slide.exitSpeed or self.t > MOVE.slide.maxTime or not self.crouchHeld or not grounded then
		self:endSlide()
	end
end

function LocalController:endSlide()
	self.motor:release()
	self.motor:freeFacing()
	self.cool.slide = MOVE.slide.cooldown
	self:stopReplicated(0.2)
	self:setMode(if self.humanoid.FloorMaterial ~= Enum.Material.Air then "Ground" else "Air")
	self:setCrouch(self.crouchHeld)
end

function LocalController:slideJump()
	local s = self.slideState
	self:endSlide()
	self:setCrouch(false)
	self.humanoid:ChangeState(Enum.HumanoidStateType.Freefall)
	self.root.AssemblyLinearVelocity = s.dir * math.max(s.speed, MOVE.sprintSpeed) + Y * MOVE.jumpVelocity
	self:setMode("Air")
	self.jumps = 1
	self.airTime = 0.1
	self:playReplicated("JumpStart", { fadeIn = 0.05 })
end

-- ------------------------------------------------------------------ wall run
function LocalController:tryWallRun(): boolean
	local W = MOVE.wallRun
	local v = self.root.AssemblyLinearVelocity
	local hv = flat(v)
	if hv.Magnitude < 10 or self.cool.wall > 0 then
		return false
	end
	if self:ray(self.root.Position, -Y * (self:rootHeight() + W.minHeight)) then
		return false
	end
	local right = self.root.CFrame.RightVector
	for _, side in ipairs({ "Left", "Right" }) do
		local toWall = if side == "Left" then -right else right
		local hit = self:ray(self.root.Position, flat(toWall).Unit * W.detectDistance)
		if hit and math.abs(hit.Normal.Y) < 0.3 then
			local n = flat(hit.Normal).Unit
			local along = hv - n * hv:Dot(n)
			if along.Magnitude > 6 and math.abs(hv.Unit:Dot(n)) < 0.8 then
				self:startWallRun(side, n, along.Unit)
				return true
			end
		end
	end
	return false
end

function LocalController:startWallRun(side: string, normal: Vector3, dir: Vector3)
	local W = MOVE.wallRun
	self:setMode("WallRun")
	local clip = ClipLibrary.get("WallRun" .. side)
	self.wallState = {
		side = side,
		normal = normal,
		dir = dir,
		vy = math.max(self.root.AssemblyLinearVelocity.Y * 0.25, W.startUpVelocity),
		distance = (clip and clip.meta.wallDistance or 2.27) * self.posScale,
	}
	self.jumps = 1
	self.airDashes = MOVE.dash.airDashes
	self.motor:face(yawOf(dir), 200)
	local speed = if clip and clip.meta.speed then W.speed / clip.meta.speed else 1
	self:playReplicated("WallRun" .. side, { fadeIn = 0.12, speed = speed })
end

function LocalController:stepWallRun(dt: number, grounded: boolean)
	local W = MOVE.wallRun
	local w = self.wallState
	w.vy = (w.vy - MOVE.gravity * W.gravityScale * dt) * 0.5 ^ (dt * 3)
	local hit = self:ray(self.root.Position, -w.normal * (W.detectDistance + 1.5))
	if grounded or self.t > W.maxTime or not hit or math.abs(hit.Normal.Y) > 0.3 then
		self:endWallRun()
		return
	end
	local n = flat(hit.Normal).Unit
	local along = w.dir - n * w.dir:Dot(n)
	if along.Magnitude > 0.1 then
		w.dir = along.Unit
	end
	w.normal = n
	local dist = (self.root.Position - hit.Position):Dot(n)
	local corr = math.clamp((w.distance - dist) * 12, -25, 25)
	self.motor:vector(w.dir * W.speed + n * corr + Y * w.vy)
	self.motor:face(yawOf(w.dir), 200)
end

function LocalController:endWallRun()
	self.motor:release()
	self.motor:freeFacing()
	self.cool.wall = MOVE.wallRun.cooldown
	self:stopReplicated(0.15)
	self:setMode("Air")
end

function LocalController:wallJump()
	local W = MOVE.wallRun
	local w = self.wallState
	local away = w.normal
	local v = w.dir * W.speed * 0.8 + away * W.jumpOut + Y * W.jumpUp
	self.motor:release()
	self.root.AssemblyLinearVelocity = v
	self:setMode("Air")
	self.cool.wall = W.cooldown
	self.jumps = 1
	self.airDashes = MOVE.dash.airDashes
	self.minAirVy = 0
	self.motor:face(yawOf(flat(v)), 60)
	self.faceRelease = 0.35
	self:playReplicated("WallJump" .. w.side, { fadeIn = 0.05 })
	CameraFX.fovKick(7, 0.35)
end

-- ------------------------------------------------------------------ vault & mantle
function LocalController:tryVault(): boolean
	local V = MOVE.vault
	local fwd = flat(self.root.CFrame.LookVector).Unit
	local feet = self:feetY()
	local p = self.root.Position
	local origin = Vector3.new(p.X, feet + 1.0, p.Z)
	local hit = self:ray(origin, fwd * V.detectDistance)
	if not hit or math.abs(hit.Normal.Y) > 0.3 then
		return false
	end
	local d = (hit.Position - origin):Dot(fwd)
	if d < 1.6 or d > 3.6 then
		return false
	end
	local face = hit.Position
	local top = self:ray(face + fwd * 0.4 + Y * (V.maxHeight + 1.5 - (face.Y - feet)), -Y * (V.maxHeight + 2))
	if not top then
		return false
	end
	local h = top.Position.Y - feet
	if h < V.minHeight or h > V.maxHeight then
		return false
	end
	local depth = nil
	for k = 1, 9 do
		local x = 0.4 * k
		local probe = Vector3.new(face.X, top.Position.Y + 0.5, face.Z) + fwd * x
		local below = self:ray(probe, -Y * 0.8)
		if not below then
			depth = x
			break
		end
	end
	if not depth or depth > V.maxDepth then
		return false
	end
	-- Headroom over the obstacle.
	if self:ray(Vector3.new(p.X, top.Position.Y + 2.6, p.Z), fwd * (d + depth + 2)) then
		return false
	end
	self:startVault(d, h, depth, fwd)
	return true
end

function LocalController:startVault(d: number, h: number, depth: number, fwd: Vector3)
	local clip = ClipLibrary.get("Vault")
	if not clip then
		return
	end
	local ob = clip.meta.obstacle
	local s = self.posScale
	local tPlant = firstMarker(clip, "HandPlant", 0.12)
	self:startRootAction("Vault", {
		yaw = yawOf(fwd),
		ghost = true,
		physics = true,
		exitSpeed = math.max(self:hSpeed() * 0.8, 14),
		warp = function(t, rm)
			local w1 = smooth01(t / tPlant)
			local w2 = smooth01((t - tPlant) / 0.15)
			local extra = (d - ob.distance * s) * w1 + (depth - ob.depth * s) * w2
			return Vector3.new(rm.X, rm.Y * (h / (ob.height * s)), rm.Z - extra)
		end,
	})
end

function LocalController:tryMantle(auto: boolean): boolean
	local M = MOVE.mantle
	local input = self:moveDir()
	local fwd = if input.Magnitude > 0 then input else flat(self.root.CFrame.LookVector).Unit
	local feet = self:feetY()
	local p = self.root.Position
	local hit = self:ray(Vector3.new(p.X, feet + 1.5, p.Z), fwd * M.detectDistance)
	if not hit or math.abs(hit.Normal.Y) > 0.3 then
		return false
	end
	local into = -flat(hit.Normal).Unit
	local probeTop = feet + M.maxHeight + 1
	local top = self:ray(Vector3.new(hit.Position.X, probeTop, hit.Position.Z) + into * 0.6, -Y * (M.maxHeight + 0.5))
	if not top or top.Normal.Y < 0.7 then
		return false
	end
	local h = top.Position.Y - feet
	if h < M.minHeight or h > M.maxHeight then
		return false
	end
	if auto and h > 5 then
		return false
	end
	if self:ray(top.Position + into * 0.8 + Y * 0.2, Y * 5.5) then
		return false -- no room to stand
	end
	local d = flat(hit.Position - p):Dot(into)
	self:startMantle(math.max(d, 0.5), h, into)
	return true
end

function LocalController:startMantle(d: number, h: number, into: Vector3)
	local clip = ClipLibrary.get("Mantle")
	if not clip then
		return
	end
	local ob = clip.meta.obstacle
	local s = self.posScale
	local tPlant = firstMarker(clip, "HandPlant", 0.14)
	self:setCrouch(false)
	self:startRootAction("Mantle", {
		yaw = yawOf(into),
		ghost = true,
		physics = true,
		exitSpeed = 0,
		warp = function(t, rm)
			local w1 = smooth01(t / tPlant)
			return Vector3.new(rm.X, rm.Y * (h / (ob.height * s)), rm.Z - (d - ob.distance * s) * w1)
		end,
	})
end

-- ------------------------------------------------------------------ clip-driven actions
--[[
	opts: yaw, planar (attacks: horizontal root motion, gravity on), ghost, physics (Humanoid
	Physics state for full 3D root motion), warp(t, rm) -> rm, exitSpeed, fadeIn, endEarly
]]
function LocalController:startRootAction(name: string, opts)
	if self.mode == "Action" and self.action then
		self:endAction(true)
	end
	local yaw = opts.yaw or self:yaw()
	local track = self:playReplicated(name, { fadeIn = opts.fadeIn or 0.06, speed = opts.speed })
	if not track then
		return nil
	end
	self:setMode("Action")
	self.action = {
		name = name,
		track = track,
		clip = track.clip,
		startPos = self.root.Position,
		yaw = yaw,
		rot = CFrame.Angles(0, yaw, 0),
		warp = opts.warp,
		planar = opts.planar,
		ghost = opts.ghost,
		physics = opts.physics,
		exitSpeed = opts.exitSpeed,
		endEarly = opts.endEarly or 0.12,
		hasRM = track.clip.owns.RootMotion == true,
	}
	self.motor:face(yaw, 300)
	if opts.ghost then
		self.motor:setGhost(true)
	end
	if opts.physics then
		self.humanoid:ChangeState(Enum.HumanoidStateType.Physics)
	end
	if not self.action.hasRM and not opts.physics then
		self.motor:planar(Vector3.zero)
	end
	return track
end

function LocalController:stepAction(dt: number)
	local a = self.action
	local tr = a.track
	if a.hasRM then
		local rm = ClipLibrary.samplePosition(a.clip, "RootMotion", tr.time) or Vector3.zero
		rm *= self.posScale
		if a.warp then
			rm = a.warp(tr.time, rm)
		end
		local target = a.startPos + a.rot:VectorToWorldSpace(rm)
		self.motor:servo(target, dt, a.planar)
	elseif a.physics then
		self.motor:vector(Vector3.zero)
	else
		self.motor:planar(Vector3.zero)
	end
	self.motor:face(a.yaw, 300)
	if tr.done or tr.stopping or tr.time >= tr.clip.length - a.endEarly then
		self:endAction(false)
	end
end

function LocalController:endAction(interrupted: boolean)
	local a = self.action
	if not a then
		return
	end
	self.action = nil
	self.motor:release()
	if a.ghost then
		self.motor:setGhost(false)
	end
	if a.physics then
		self.humanoid:ChangeState(Enum.HumanoidStateType.Freefall)
	end
	if a.exitSpeed and not interrupted then
		local v = self.root.AssemblyLinearVelocity
		self.root.AssemblyLinearVelocity = forwardOf(a.yaw) * a.exitSpeed + Y * math.min(v.Y, 0)
	end
	if self.attack and self.attack.track == a.track then
		self.attack = nil
	end
	if not interrupted then
		self.motor:freeFacing()
		local grounded = self.humanoid.FloorMaterial ~= Enum.Material.Air
		self:setMode(if grounded or not a.physics then "Ground" else "Air")
		self.minAirVy = 0
		self.airTime = 0.1
		if self.blockQueued then
			self.blockQueued = false
			self:setBlock(true)
		end
	end
end

-- ------------------------------------------------------------------ combat
function LocalController:canAct(): boolean
	return self.stunT <= 0 and self.mode ~= "Flight" and self.mode ~= "Down"
end

function LocalController:startAttack(name: string)
	local def = ATTACKS[name]
	if not def then
		return
	end
	self:setArmed(true)
	if self.blocking then
		self.blocking = false
		Net.send("State", { blocking = false })
	end
	self:setCrouch(false)
	local yaw = self:aimYaw()
	self.attackSeq += 1
	local id = self.attackSeq
	local track = self:startRootAction(def.clip, {
		yaw = yaw,
		planar = true,
		fadeIn = if name == "Light1" then 0.06 else 0.05,
	})
	if not track then
		return
	end
	self.attack = {
		id = id,
		name = name,
		def = def,
		track = track,
		yaw = yaw,
		startFrame = CFrame.new(self.root.Position) * CFrame.Angles(0, yaw, 0),
		comboOpen = false,
		queued = nil,
		hitKeys = {},
		window = firstMarker(track.clip, "ComboWindow", track.clip.length),
	}
	Net.send("Attack", name, yaw, id)
end

function LocalController:light()
	if not self:canAct() then
		return
	end
	local m = self.mode
	if m == "Air" then
		self:aerialSlam()
		return
	end
	if m == "Action" and self.attack then
		local atk = self.attack
		local nextName = atk.def.next
		if nextName then
			if atk.comboOpen then
				self:startAttack(nextName)
			elseif atk.window - atk.track.time <= Config.Combat.comboBuffer then
				atk.queued = nextName
			end
		end
		return
	end
	if m == "Dash" and not self.dashState.air then
		-- Dash-cancel into the opener.
		self.motor:release()
		self:setMode("Ground")
	end
	if self.mode == "Ground" and not self.blocking then
		if not self.armed then
			self:startAttack("Draw")
		else
			self:startAttack("Light1")
		end
	end
end

function LocalController:heavy()
	if not self:canAct() then
		return
	end
	if self.mode == "Air" then
		self:aerialSlam()
		return
	end
	if self.mode == "Action" and self.attack and self.attack.comboOpen then
		self:endAction(true)
		self:setMode("Ground")
	end
	if self.mode ~= "Ground" or self.blocking then
		return
	end
	self:setArmed(true)
	self:setCrouch(false)
	self:setMode("Charge")
	self.chargeState = { released = false }
	self:playReplicated("HeavyCharge", { fadeIn = 0.12 })
	Net.send("Charge")
end

function LocalController:stepCharge(dt: number)
	local c = self.chargeState
	local yaw = self.camera:getYaw()
	self.motor:face(yaw, 200)
	self.motor:planar(Vector3.zero)
	self.driver.glowTarget = 0.6 + math.min(self.t, 1.5) * 1.6
	if math.floor((self.t - dt) * 40) ~= math.floor(self.t * 40) then
		Particles.emit("ChargeMotes", 2, self.driver.weapon:worldPoint("mid"), { sizeScale = 0.8 })
	end
	if c.released and self.t >= ATTACKS.Heavy.minCharge then
		self.chargeState = nil
		self.driver.glowTarget = 0.35
		self.motor:release()
		self:setMode("Ground")
		self:startAttack("Heavy")
	end
end

function LocalController:releaseCharge()
	if self.mode == "Charge" and self.chargeState then
		self.chargeState.released = true
	end
end

function LocalController:lunge()
	if not self:canAct() or self.cool.lunge > 0 then
		return
	end
	if self.mode == "Action" and self.attack and self.attack.comboOpen then
		self:endAction(true)
		self:setMode("Ground")
	end
	if self.mode ~= "Ground" and not (self.mode == "Dash" and not self.dashState.air) then
		return
	end
	self.cool.lunge = Config.Combat.lungeCooldown
	self.motor:release()
	self:setMode("Ground")
	self:startAttack("Lunge")
end

function LocalController:aerialSlam()
	if self.mode ~= "Air" or self.slamUsed then
		return
	end
	self.slamUsed = true
	self:setArmed(true)
	self:setMode("Aerial")
	local v = self.root.AssemblyLinearVelocity
	self.aerialState = { vy = ATTACKS.Aerial.diveVelocity * 0.35, h = flat(v) * 0.3 }
	self.motor:face(self:aimYaw(), 200)
	self:playReplicated("AerialSlam", { fadeIn = 0.08 })
	Effects.play("DashBurst", self.root.Position, { forward = -Y })
	Net.send("Slam")
end

function LocalController:stepAerial(dt: number)
	local a = self.aerialState
	a.vy = math.max(a.vy - MOVE.gravity * 1.6 * dt, ATTACKS.Aerial.diveVelocity)
	local reach = self:rootHeight() + math.abs(a.vy) * dt + 0.6
	local hit = self:ray(self.root.Position, -Y * reach)
	if hit then
		-- Touch down exactly on the floor, then slam.
		self.motor:vector(Vector3.zero)
		local p = self.root.Position
		self.root.CFrame = CFrame.new(p.X, hit.Position.Y + self:rootHeight(), p.Z) * self.root.CFrame.Rotation
		self.slamUsed = false
		self.jumps = 0
		self.airDashes = MOVE.dash.airDashes
		self.minAirVy = 0
		self.motor:release()
		self:setMode("Ground")
		self:startAttack("Aerial")
		return
	end
	self.motor:vector(a.h + Y * a.vy)
end

function LocalController:setBlock(on: boolean)
	if on then
		if self.blocking or not self:canAct() then
			return
		end
		if self.mode == "Action" then
			self.blockQueued = true
			return
		end
		if self.mode ~= "Ground" then
			return
		end
		self.blocking = true
		self:setArmed(true)
		self:setCrouch(false)
		-- Others see the guard through the replicated AAA_Blocking attribute.
		self.driver:play("Block", { fadeIn = 0.08 })
		Net.send("State", { blocking = true })
	else
		self.blockQueued = false
		if not self.blocking then
			return
		end
		self.blocking = false
		if self.mode == "Ground" then
			self.driver:stopAction(0.15)
		end
		Net.send("State", { blocking = false })
	end
end

function LocalController:drawOrSheath()
	if not self:canAct() or self.mode ~= "Ground" or self.blocking then
		return
	end
	if self.armed then
		self:setArmed(false)
		self:playReplicated("Sheath", { fadeIn = 0.1 })
	else
		self:startAttack("Draw")
	end
end

-- Animation events from our own driver.
function LocalController:onAnimEvent(name: string, data, track)
	local atk = self.attack
	if name == "ComboWindow" and atk and atk.track == track then
		atk.comboOpen = true
		if atk.queued then
			local nextName = atk.queued
			atk.queued = nil
			self:startAttack(nextName)
		end
	elseif name == "HitStart" and atk and atk.track == track then
		self:queryHits(data, track)
	elseif (name == "HeavyImpact" or name == "SlamImpact") and atk and atk.track == track then
		self:radialHits(name)
	end
end

function LocalController:queryHits(marker, track)
	local atk = self.attack
	local swing = HitQuery.swingAt(track.clip, marker.t)
	local finisher = marker.finisher == true
	local hits = HitQuery.swingHits(atk.startFrame, atk.def, swing, marker.t, Drivers.candidates(self.model), self.posScale)
	local claimed = {}
	for _, h in ipairs(hits) do
		local key = h.model
		local keyed = atk.hitKeys[key]
		if not (keyed and keyed[finisher]) then
			atk.hitKeys[key] = keyed or {}
			atk.hitKeys[key][finisher] = true
			table.insert(claimed, h.model)
			table.insert(self.pending, { hit = h, finisher = finisher, atk = atk, track = track })
		end
	end
	if #claimed > 0 then
		Net.send("HitClaim", atk.name, finisher, claimed, atk.id)
	end
end

function LocalController:radialHits(markerName: string)
	local atk = self.attack
	local def = atk.def
	local center
	if markerName == "SlamImpact" then
		center = self.root.Position - Y * self:rootHeight() + forwardOf(atk.yaw) * 1.5
	else
		local tip = self.driver.weapon:worldPoint("tip")
		center = Vector3.new(tip.X, self:feetY(), tip.Z)
	end
	local hits = HitQuery.radialHits(center, def.radius or 9, Drivers.candidates(self.model))
	local claimed = {}
	for _, h in ipairs(hits) do
		local keyed = atk.hitKeys[h.model]
		if not (keyed and keyed[true]) then
			atk.hitKeys[h.model] = keyed or {}
			atk.hitKeys[h.model][true] = true
			table.insert(claimed, h.model)
			self:predictHit(h, true, atk, true)
		end
	end
	if #claimed > 0 then
		Net.send("HitClaim", atk.name, true, claimed, atk.id, center)
	end
end

local function victimGuards(victim: Model, attackerPos: Vector3): boolean
	if victim:GetAttribute("AAA_Blocking") ~= true then
		return false
	end
	local root = victim:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not root then
		return false
	end
	local to = flat(attackerPos - root.Position)
	return to.Magnitude > 0.1 and to.Unit:Dot(root.CFrame.LookVector) > 0.2
end

-- Client-side prediction of a hit's feedback; the server's verdict follows.
function LocalController:predictHit(h, finisher: boolean, atk, radial: boolean?)
	local def = atk.def
	if finisher and def.finisher then
		def = Util.merge(def, def.finisher)
	end
	if victimGuards(h.model, self.root.Position) and not def.guardBreak then
		return -- blocked/parried: wait for the server so the result is never wrong
	end
	local victim = Drivers.get(h.model)
	local point = if radial then h.root.Position + Y * 0.4 else h.point:Lerp(h.root.Position + Y * 0.5, 0.5)
	Effects.play(if radial then "Hit" else (def.effect or "Hit"), point, { slash = h.dir, normal = forwardOf(atk.yaw) })
	self.driver.anim:hitStop(def.hitStop or 0.07, 0)
	CameraFX.shake(def.shake or "Light")
	if def.impactFrame then
		CameraFX.impactFrame(def.impactFrame)
	end
	if finisher and not radial then
		CameraFX.flash(0.25, "#e8f8ff")
	end
	if victim then
		victim:flash(1)
		victim.anim:hitStop(def.hitStop or 0.07, 0.07)
		if def.knockback or def.launch or finisher then
			victim:launch()
		else
			victim:play(HitQuery.flinch(h.root.CFrame, self.root.Position), { fadeIn = 0.02 })
		end
	end
	self.predicted[h.model] = { id = atk.id, at = os.clock() }
end

function LocalController:processPending()
	local keep = {}
	for _, p in ipairs(self.pending) do
		if p.track.time >= p.hit.t or p.track.done or p.track.stopping then
			self:predictHit(p.hit, p.finisher, p.atk, false)
		else
			table.insert(keep, p)
		end
	end
	self.pending = keep
end

-- Was this server hit already shown locally?
function LocalController:wasPredicted(victim: Model, id: number?): boolean
	local p = self.predicted[victim]
	return p ~= nil and (id == nil or p.id == id) and os.clock() - p.at < 1.5
end

-- ------------------------------------------------------------------ being hit
function LocalController:onHitResult(info)
	-- We are the victim (server verdict).
	local r = info.result
	if r == "blocked" then
		self.driver:play("BlockHit", { fadeIn = 0.02 })
		task.delay(0.3, function()
			if self.blocking and self.mode == "Ground" then
				self.driver:play("Block", { fadeIn = 0.1 })
			end
		end)
		self.root.AssemblyLinearVelocity += flat(info.dir or Vector3.zero) * Tuning.DEFENSE.blockPush
		CameraFX.shake("Light")
	elseif r == "parried" then
		self.blocking = false
		self.driver:play("Parry", { fadeIn = 0.02 })
		CameraFX.slowmo(Tuning.DEFENSE.parrySlowmo[1], Tuning.DEFENSE.parrySlowmo[2])
		CameraFX.flash(0.16, "#fff2c8")
		CameraFX.shake("Parry")
		CameraFX.impactFrame(0.05)
	elseif r == "guardbreak" then
		self.blocking = false
		self:stagger("GuardBreak")
	elseif r == "hit" then
		self.stunT = info.stun or 0.4
		-- Hit-stun interrupts our own wind-up or swing (the server already cancelled it).
		if self.mode == "Charge" then
			self.chargeState = nil
			self.driver.glowTarget = 0.35
			self.motor:release()
			self:stopReplicated(0.1)
			self:setMode("Ground")
		elseif self.mode == "Action" and self.attack then
			self:endAction(true)
			self:stopReplicated(0.1)
			self.motor:freeFacing()
			self:setMode("Ground")
		end
		if info.push and info.push > 0 and self.mode == "Ground" then
			self.root.AssemblyLinearVelocity += flat(info.dir or Vector3.zero) * info.push
		end
		CameraFX.shake(info.shake or "Light", 0.8)
	end
end

-- We attacked and got parried.
function LocalController:onParried()
	self:stagger("Parried")
	CameraFX.slowmo(Tuning.DEFENSE.parrySlowmo[1], Tuning.DEFENSE.parrySlowmo[2])
	CameraFX.shake("Parry")
end

function LocalController:stagger(name: string)
	self.stunT = 0.8
	self:startRootAction(name, { fadeIn = 0.03, planar = true })
end

function LocalController:knockback(vel: Vector3, launch: number)
	if self.action then
		self:endAction(true)
	end
	self.motor:release()
	self.motor:setGhost(false)
	self.blocking = false
	self.chargeState = nil
	self:setMode("Flight")
	self.humanoid:ChangeState(Enum.HumanoidStateType.Freefall)
	self.root.AssemblyLinearVelocity = flat(vel) + Y * launch
	if flat(vel).Magnitude > 0.1 then
		self.motor:face(yawOf(-flat(vel).Unit), 80)
	end
	self.driver:launch()
end

-- ------------------------------------------------------------------ per-step
function LocalController:step(dt: number)
	self.t += dt
	for k, v in pairs(self.cool) do
		self.cool[k] = v - dt
	end
	self.stunT = math.max(0, self.stunT - dt)
	self.landLock = math.max(0, self.landLock - dt)
	if self.faceRelease then
		self.faceRelease -= dt
		if self.faceRelease <= 0 then
			self.faceRelease = nil
			if self.mode == "Air" then
				self.motor:freeFacing()
			end
		end
	end
	local hum = self.humanoid
	local v = self.root.AssemblyLinearVelocity
	local grounded = hum.FloorMaterial ~= Enum.Material.Air
	if not grounded then
		self.minAirVy = math.min(self.minAirVy, v.Y)
	end

	local m = self.mode
	if m == "Ground" then
		if not grounded then
			if self.blocking then
				self:setBlock(false)
			end
			self:setMode("Air")
			self.airTime = 0
			self.minAirVy = math.min(0, v.Y)
		else
			self:stepGround(dt)
		end
	elseif m == "Air" then
		self.airTime += dt
		hum.WalkSpeed = if self:isSprinting() then MOVE.sprintSpeed else MOVE.walkSpeed
		if grounded and v.Y <= 1 and self.airTime > 0.05 then
			self:land()
		elseif not self:tryWallRun() and self.airTime > 0.15 and v.Y < 12 and self:moveDir().Magnitude > 0 then
			self:tryMantle(true)
		end
	elseif m == "Dash" then
		self:stepDash(dt)
	elseif m == "Slide" then
		self:stepSlide(dt, grounded)
	elseif m == "WallRun" then
		self:stepWallRun(dt, grounded)
	elseif m == "Action" then
		if self.action then
			self:stepAction(dt)
		else
			self:setMode("Ground")
		end
	elseif m == "Charge" then
		self:stepCharge(dt)
	elseif m == "Aerial" then
		self:stepAerial(dt)
	elseif m == "Flight" then
		hum.WalkSpeed = 0
		if self.t > 0.15 and grounded and v.Y <= 2 then
			self:setMode("Down")
		end
	elseif m == "Down" then
		hum.WalkSpeed = 0
		self.motor:planar(flat(v) * 0.02 ^ dt)
		if self.t > 1.75 then
			self.motor:release()
			self.motor:freeFacing()
			self:setMode("Ground")
		end
	end
	self:processPending()

	-- Feed the animation driver with exact local state.
	local speed = flat(self.root.AssemblyLinearVelocity).Magnitude
	if self.mode == "Charge" or self.mode == "Down" or self.mode == "Flight" then
		speed = 0
	end
	self.driver:setState({
		speed = speed,
		vy = self.root.AssemblyLinearVelocity.Y,
		grounded = grounded and self.mode ~= "Air" and self.mode ~= "WallRun" and self.mode ~= "Aerial",
		crouch = self.crouch,
		armed = self.armed,
		yaw = self:yaw(),
	})
end

function LocalController:stepGround(dt: number)
	local hum = self.humanoid
	local input = self:moveDir()
	local speed = MOVE.walkSpeed
	if self.landLock > 0 then
		speed = 2
	elseif self.crouch then
		speed = MOVE.crouchSpeed
	elseif self.blocking then
		speed = MOVE.blockSpeed
	elseif self:isSprinting() and input.Magnitude > 0 then
		speed = MOVE.sprintSpeed
	end
	if self.stunT > 0 then
		speed *= 0.3
	end
	hum.WalkSpeed = speed
	if self.blocking or self.camera:isFirstPerson() then
		self.motor:face(self.camera:getYaw(), 200)
	else
		self.motor:freeFacing()
	end
	if input.Magnitude > 0 and self:hSpeed() > 10 and not self.blocking and not self.crouch then
		self:tryVault()
	end
end

return LocalController
