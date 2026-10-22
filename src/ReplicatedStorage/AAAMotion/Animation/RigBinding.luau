--[[
	Binds evaluated poses (joint -> CFrame) to a character's Motor6Ds by writing Motor6D.Transform.

	Clips are authored on the standard R15 proportions (hip-to-sole 1.83 studs). For other body
	scales the binding measures the real leg chain in the rest pose and
	  * scales clip translations by realLeg / 1.83 (posScale), and
	  * offsets the Root joint so the soles sit on the floor the Humanoid stands on (rootOffset).
	Rotations transfer unchanged.

	Write poses from RunService.PreSimulation: that runs after the engine's Animator and before
	physics, so the Transform values stick for the frame.
]]

local RigBinding = {}
RigBinding.__index = RigBinding

local IDENTITY = CFrame.identity

function RigBinding.new(model: Model, rig)
	local self = setmetatable({}, RigBinding)
	self.model = model
	self.rig = rig
	self.motors = {} :: { [string]: Motor6D }
	self.posScale = 1
	self.rootOffset = 0
	for _, j in ipairs(rig.joints) do
		if j.name ~= "Weapon" then
			local part1 = model:FindFirstChild(j.part1)
			local motor = part1 and part1:FindFirstChild(j.name)
			if motor and motor:IsA("Motor6D") then
				self.motors[j.name] = motor
			end
		end
	end
	self:measure()
	return self
end

function RigBinding:isComplete(): boolean
	for _, j in ipairs(self.rig.joints) do
		if j.name ~= "Weapon" and not self.motors[j.name] then
			return false
		end
	end
	return true
end

-- Measures leg length and floor offset from the rig's rest pose (Transform = identity).
function RigBinding:measure()
	local model = self.model
	local m = self.motors
	local hrp = model:FindFirstChild("HumanoidRootPart") :: BasePart?
	local hum = model:FindFirstChildOfClass("Humanoid")
	local foot = model:FindFirstChild("LeftFoot") :: BasePart?
	if not (hrp and hum and foot and m.Root and m.LeftHip and m.LeftKnee and m.LeftAnkle) then
		return
	end
	local function link(name: string): CFrame
		local mo = m[name]
		return mo.C0 * mo.C1:Inverse()
	end
	local lowerTorso = link("Root")
	local hip = lowerTorso * m.LeftHip.C0
	local footCF = lowerTorso * link("LeftHip") * link("LeftKnee") * link("LeftAnkle")
	local sole = footCF * CFrame.new(0, -foot.Size.Y / 2, 0)
	local leg = hip.Position.Y - sole.Position.Y
	if leg > 0.2 then
		self.posScale = math.clamp(leg / self.rig.hipHeight, 0.25, 4)
	end
	if hum.HipHeight > 0 then
		local floorY = -(hum.HipHeight + hrp.Size.Y / 2)
		self.rootOffset = math.clamp(floorY - sole.Position.Y, -1.5, 1.5)
	end
end

-- Scales a joint transform's translation by the rig's proportions.
function RigBinding:scaled(t: CFrame): CFrame
	local s = self.posScale
	if s == 1 then
		return t
	end
	return CFrame.new(t.Position * s) * t.Rotation
end

function RigBinding:apply(pose: { [string]: CFrame })
	local s = self.posScale
	local off = self.rootOffset
	for name, motor in pairs(self.motors) do
		local t = pose[name]
		if t then
			if s ~= 1 then
				t = CFrame.new(t.Position * s) * t.Rotation
			end
			if off ~= 0 and name == "Root" then
				t = CFrame.new(0, off, 0) * t
			end
			motor.Transform = t
		end
	end
end

function RigBinding:reset()
	for _, motor in pairs(self.motors) do
		motor.Transform = IDENTITY
	end
end

return RigBinding
