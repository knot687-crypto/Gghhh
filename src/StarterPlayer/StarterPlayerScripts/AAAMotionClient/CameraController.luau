--[[
	Camera: over-the-shoulder third person with collision, or first person driven by the
	viewmodel's "Camera" joint. Adds FOV dynamics (sprint / slide / dash kicks), wall-run roll
	and the CameraFX layer (trauma shake, impact frames, flashes).

	Mouse is locked to the centre while playing; hold Left Alt to free the cursor.
]]

local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local AAAMotion = game:GetService("ReplicatedStorage"):WaitForChild("AAAMotion")
local CameraFX = require(AAAMotion.VFX.CameraFX)
local Config = require(AAAMotion.Config)
local Util = require(AAAMotion.Util)
local Tuning = require(AAAMotion.Generated.Tuning)

local MOVE = Tuning.MOVE
local C = Config.Camera

local CameraController = {}
CameraController.__index = CameraController

function CameraController.new()
	local self = setmetatable({}, CameraController)
	self.yaw = 0
	self.pitch = math.rad(-12)
	self.distance = C.distance
	self.zoomTarget = C.distance
	self.firstPerson = C.startFirstPerson
	self.fov = MOVE.fov.base
	self.roll = 0
	self.focus = nil
	self.stick = Vector2.zero
	self.subject = nil -- { driver, controller }
	self.viewmodel = nil
	self.rayParams = RaycastParams.new()
	self.rayParams.FilterType = Enum.RaycastFilterType.Exclude
	self.rayParams.RespectCanCollide = true
	self.connections = {
		UserInputService.InputChanged:Connect(function(input, processed)
			self:onInput(input, processed)
		end),
	}
	return self
end

function CameraController:setSubject(driver, controller)
	self.subject = { driver = driver, controller = controller }
	self.focus = nil
	self.rayParams.FilterDescendantsInstances = { driver.model, require(AAAMotion.Combat.Weapon).localFolder(), workspace.CurrentCamera }
	self.yaw = Util.yawOf(Util.flat(driver.root.CFrame.LookVector))
	driver:setFirstPerson(self.firstPerson)
	if self.viewmodel then
		self.viewmodel:setEnabled(self.firstPerson)
	end
end

function CameraController:getYaw(): number
	return self.yaw
end

function CameraController:getPitch(): number
	return self.pitch
end

function CameraController:isFirstPerson(): boolean
	return self.firstPerson
end

function CameraController:toggleView()
	self.firstPerson = not self.firstPerson
	local s = self.subject
	if s then
		s.driver:setFirstPerson(self.firstPerson)
	end
	if self.viewmodel then
		self.viewmodel:setEnabled(self.firstPerson)
	end
end

function CameraController:onInput(input: InputObject, processed: boolean)
	if input.UserInputType == Enum.UserInputType.MouseWheel and not processed then
		self.zoomTarget = math.clamp(self.zoomTarget - input.Position.Z * 2, C.minDistance, C.maxDistance)
	elseif input.KeyCode == Enum.KeyCode.Thumbstick2 then
		local p = Vector2.new(input.Position.X, input.Position.Y)
		self.stick = if p.Magnitude > 0.15 then p else Vector2.zero
	elseif input.UserInputType == Enum.UserInputType.Touch and not processed then
		self:rotate(input.Delta.X * 0.006, input.Delta.Y * 0.006)
	end
end

function CameraController:rotate(dx: number, dy: number)
	self.yaw -= dx
	self.pitch = math.clamp(self.pitch - dy, math.rad(C.pitchMin), math.rad(C.pitchMax))
end

-- Called every render frame (after input, before the viewmodel).
function CameraController:update(dt: number)
	local cam = workspace.CurrentCamera
	if cam.CameraType ~= Enum.CameraType.Scriptable then
		cam.CameraType = Enum.CameraType.Scriptable
	end
	local free = UserInputService:IsKeyDown(Enum.KeyCode.LeftAlt)
	UserInputService.MouseBehavior = if free then Enum.MouseBehavior.Default else Enum.MouseBehavior.LockCenter
	UserInputService.MouseIconEnabled = free
	if not free then
		local sens = C.mouseSensitivity
		local ok, gs = pcall(function()
			return UserSettings():GetService("UserGameSettings")
		end)
		if ok and gs then
			sens *= gs.MouseSensitivity
		end
		local d = UserInputService:GetMouseDelta()
		self:rotate(d.X * sens, d.Y * sens)
	end
	if self.stick.Magnitude > 0 then
		self:rotate(self.stick.X * C.gamepadSensitivity * dt, -self.stick.Y * C.gamepadSensitivity * 0.7 * dt)
	end

	local s = self.subject
	if not s or not s.driver.root.Parent then
		return
	end
	local driver, ctrl = s.driver, s.controller
	local root = driver.root
	local scale = driver.posScale

	-- FOV: sprint / slide targets plus kicks from CameraFX.
	local mode = ctrl.mode
	local speed = Util.flat(root.AssemblyLinearVelocity).Magnitude
	local target = MOVE.fov.base
	if mode == "Slide" then
		target = MOVE.fov.slide
	elseif mode == "Dash" then
		target = MOVE.fov.sprint
	elseif speed > 20 and ctrl:isSprinting() then
		target = MOVE.fov.sprint
	end
	self.fov = Util.damp(self.fov, target, 6, dt)
	local rollTarget = 0
	if mode == "WallRun" and ctrl.wallState then
		rollTarget = if ctrl.wallState.side == "Left" then -7 else 7
	end
	self.roll = Util.damp(self.roll, rollTarget, 8, dt)

	local rot = CFrame.Angles(0, self.yaw, 0) * CFrame.Angles(self.pitch, 0, 0)
	local camCF
	if self.firstPerson then
		local eye = root.Position + Vector3.new(0, C.firstPersonEye * scale, 0)
		local base = CFrame.new(eye) * rot
		if self.viewmodel then
			camCF = self.viewmodel:cameraCFrame(base, dt)
		else
			camCF = base
		end
	else
		-- Smoothed focus: tight horizontally, softer vertically (absorbs jump/land bobs).
		local want = root.Position + Vector3.new(0, C.shoulder.Y * scale, 0)
		local f = self.focus or want
		local kh = 1 - math.exp(-C.followRate * 1.6 * dt)
		local kv = 1 - math.exp(-C.followRate * 0.6 * dt)
		f = Vector3.new(f.X + (want.X - f.X) * kh, f.Y + (want.Y - f.Y) * kv, f.Z + (want.Z - f.Z) * kh)
		self.focus = f
		self.distance = Util.damp(self.distance, self.zoomTarget, 10, dt)
		local yawCF = CFrame.Angles(0, self.yaw, 0)
		local pivot = f + yawCF:VectorToWorldSpace(Vector3.new(C.shoulder.X * scale, 0, 0))
		local back = rot:VectorToWorldSpace(Vector3.new(0, 0, self.distance))
		local hit = workspace:Raycast(f, pivot - f, self.rayParams)
		if hit then
			pivot = f + (pivot - f).Unit * math.max(0, hit.Distance - 0.3)
		end
		local hit2 = workspace:Raycast(pivot, back, self.rayParams)
		local dist = if hit2 then math.max(0.5, hit2.Distance - 0.4) else self.distance
		camCF = CFrame.new(pivot + back.Unit * dist) * rot
	end
	camCF *= CFrame.Angles(0, 0, math.rad(self.roll))
	local offset, fovDelta = CameraFX.update(dt)
	cam.CFrame = camCF * offset
	cam.FieldOfView = math.clamp(self.fov + fovDelta, 40, 110)
end

function CameraController:start()
	RunService:BindToRenderStep("AAAMotionCamera", Enum.RenderPriority.Camera.Value + 1, function(dt)
		self:update(dt)
	end)
end

return CameraController
