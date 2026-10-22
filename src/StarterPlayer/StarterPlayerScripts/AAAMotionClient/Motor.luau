--[[
	Physics actuators for the local character: one LinearVelocity (planar or full vector) and one
	AlignOrientation on the root attachment, plus "ghost" collisions for vault/mantle.

	Abilities set a velocity every physics step; a root-motion servo converts clip root motion
	into the velocity that lands the root exactly on the warped target next step.
]]

local PhysicsService = game:GetService("PhysicsService")

local GHOST_GROUP = "AAAGhost"
local FORCE = 1e7

local Motor = {}
Motor.__index = Motor

function Motor.new(character: Model)
	local self = setmetatable({}, Motor)
	local root = character:WaitForChild("HumanoidRootPart") :: BasePart
	self.character = character
	self.root = root
	self.humanoid = character:FindFirstChildOfClass("Humanoid") :: Humanoid
	local att = root:FindFirstChild("RootAttachment") :: Attachment?
	if not att then
		local a = Instance.new("Attachment")
		a.Name = "RootAttachment"
		a.Parent = root
		att = a
	end

	local lv = Instance.new("LinearVelocity")
	lv.Name = "AAAMover"
	lv.Attachment0 = att
	lv.RelativeTo = Enum.ActuatorRelativeTo.World
	lv.ForceLimitsEnabled = true
	lv.ForceLimitMode = Enum.ForceLimitMode.Magnitude
	lv.MaxForce = FORCE
	lv.PrimaryTangentAxis = Vector3.xAxis
	lv.SecondaryTangentAxis = Vector3.zAxis
	lv.Enabled = false
	lv.Parent = root
	self.lv = lv

	local ao = Instance.new("AlignOrientation")
	ao.Name = "AAAAligner"
	ao.Mode = Enum.OrientationAlignmentMode.OneAttachment
	ao.Attachment0 = att
	ao.MaxTorque = FORCE
	ao.Responsiveness = 120
	ao.RigidityEnabled = false
	ao.Enabled = false
	ao.Parent = root
	self.ao = ao
	self.yaw = 0
	self.ghost = nil
	return self
end

-- Horizontal velocity only; gravity and the Humanoid's floor spring keep working vertically.
function Motor:planar(v: Vector3)
	local lv = self.lv
	lv.VelocityConstraintMode = Enum.VelocityConstraintMode.Plane
	lv.PlaneVelocity = Vector2.new(v.X, v.Z)
	lv.Enabled = true
end

-- Full velocity control (overrides gravity).
function Motor:vector(v: Vector3)
	local lv = self.lv
	lv.VelocityConstraintMode = Enum.VelocityConstraintMode.Vector
	lv.VectorVelocity = v
	lv.Enabled = true
end

function Motor:release()
	self.lv.Enabled = false
end

-- Velocity that moves the root onto `target` within one step (clamped).
function Motor:servo(target: Vector3, dt: number, planar: boolean?, maxSpeed: number?)
	local v = (target - self.root.Position) / math.max(dt, 1 / 240)
	local cap = maxSpeed or 160
	if v.Magnitude > cap then
		v = v.Unit * cap
	end
	if planar then
		self:planar(v)
	else
		self:vector(v)
	end
	return v
end

function Motor:face(yaw: number, responsiveness: number?)
	self.yaw = yaw
	local ao = self.ao
	ao.CFrame = CFrame.Angles(0, yaw, 0)
	local r = responsiveness or 120
	if ao.Responsiveness ~= r then
		ao.Responsiveness = r
	end
	if not ao.Enabled then
		ao.Enabled = true
		self.humanoid.AutoRotate = false
	end
end

function Motor:freeFacing()
	if self.ao.Enabled then
		self.ao.Enabled = false
		self.humanoid.AutoRotate = true
	end
end

local ghostOk: boolean? = nil
local function ghostAvailable(): boolean
	if ghostOk == nil then
		local ok, registered = pcall(function()
			return PhysicsService:IsCollisionGroupRegistered(GHOST_GROUP)
		end)
		ghostOk = ok and registered == true
	end
	return ghostOk :: boolean
end

-- Ghost mode lets vault/mantle root motion pass over obstacle edges without snagging.
function Motor:setGhost(on: boolean)
	if on and not self.ghost then
		local saved = {}
		for _, d in ipairs(self.character:GetDescendants()) do
			if d:IsA("BasePart") then
				if ghostAvailable() then
					saved[d] = d.CollisionGroup
					d.CollisionGroup = GHOST_GROUP
				else
					saved[d] = d.CanCollide
					d.CanCollide = false
				end
			end
		end
		self.ghost = saved
	elseif not on and self.ghost then
		for part, v in pairs(self.ghost) do
			if part.Parent then
				if type(v) == "string" then
					part.CollisionGroup = v
				else
					part.CanCollide = v
				end
			end
		end
		self.ghost = nil
	end
end

function Motor:destroy()
	self:setGhost(false)
	self.lv:Destroy()
	self.ao:Destroy()
end

return Motor
