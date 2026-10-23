--[[
	Runs a scripted scenario through the Luau CharacterAnimator and prints sampled poses.
	usage: luaurun parity.luau <mock.luau> <src/ReplicatedStorage/AAAMotion> <manifest.txt> <scenario.luau>
]]

local mock = loadfile(arg[2])()
local base, manifestPath, scenarioPath = arg[3], arg[4], arg[5]
local AAAMotion = mock.mount("AAAMotion", base, readfile(manifestPath))

local CharacterAnimator = require(AAAMotion.Animation.CharacterAnimator)
local Rig = require(AAAMotion.Generated.Rig)
local sc = loadfile(scenarioPath)()

local anim = CharacterAnimator.new(Rig.R15)
anim.visualLift = true
local frame = 0
anim:on(function(name, data)
	local extra = data and (data.foot or data.to or "") or ""
	print(string.format("E %d %s %s", frame, name, tostring(extra)))
end)

local joints = {}
for _, j in ipairs(Rig.R15.joints) do
	table.insert(joints, j.name)
end

for f, st in ipairs(sc.frames) do
	frame = f - 1
	for _, cmd in ipairs(st.cmds) do
		local op = cmd[1]
		if op == "play" then
			anim:play(cmd[2], cmd[3])
		elseif op == "stop" then
			anim:stopAction(cmd[2])
		elseif op == "overlay" then
			anim:setOverlay(cmd[2], cmd[3])
		elseif op == "hitstop" then
			anim:hitStop(cmd[2], cmd[3])
		end
	end
	anim:update(sc.dt, st.state)
	local pose = anim:evaluate()
	if frame % sc.every == 0 then
		for _, name in ipairs(joints) do
			local t = pose[name]
			if t then
				local qx, qy, qz, qw = CFrame.toQuat(t)
				if qw < 0 then
					qx, qy, qz, qw = -qx, -qy, -qz, -qw
				end
				print(string.format("P %d %s %.6f %.6f %.6f %.6f %.6f %.6f %.6f", frame, name, t[1], t[2], t[3], qx, qy, qz, qw))
			end
		end
	end
end
