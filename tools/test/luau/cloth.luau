--[[
	Headless check of VFX/ClothTails: runs the tails on a stub rig that idles, runs, dashes and
	stops, and verifies the simulation stays finite, inextensible and physically plausible.
	usage: luaurun cloth.luau <mock.luau> <src/ReplicatedStorage/AAAMotion> <manifest.txt>
]]
local mock = loadfile(arg[2])()

-- Minimal Roblox stubs the module touches (beyond the mock's Vector3/CFrame).
local function stubEnum()
	local mt = {}
	mt.__index = function(t, k)
		local v = setmetatable({ _name = k }, mt)
		rawset(t, k, v)
		return v
	end
	return setmetatable({}, mt)
end
Enum = stubEnum()
Color3 = {
	fromHex = function(h)
		return { hex = h }
	end,
	fromRGB = function(r, g, b)
		return { r = r, g = g, b = b }
	end,
	new = function(r, g, b)
		return { r = r, g = g, b = b }
	end,
}
local created = {}
Instance = {
	new = function(class)
		local o = { ClassName = class, Size = Vector3.one, CFrame = CFrame.identity }
		function o:Destroy() end
		table.insert(created, o)
		return o
	end,
}
workspace = {
	BulkMoveTo = function(_, parts, cfs)
		for i, p in ipairs(parts) do
			p.CFrame = cfs[i]
		end
	end,
}

local AAAMotion = mock.mount("AAAMotion", arg[3], readfile(arg[4]))
local ClothTails = require(AAAMotion.VFX.ClothTails)
local Rig = require(AAAMotion.Generated.Rig)

-- Stub rig: parts placed from the R15 rest pose, moved rigidly with the root.
local parts = {}
local rest = {
	LowerTorso = Vector3.new(0, -0.8, 0),
	UpperTorso = Vector3.new(0, 0.2, 0),
	Head = Vector3.new(0, 1.5, 0),
	LeftUpperLeg = Vector3.new(-0.5, -1.42, 0),
	RightUpperLeg = Vector3.new(0.5, -1.42, 0),
	LeftLowerLeg = Vector3.new(-0.5, -2.2, 0),
	RightLowerLeg = Vector3.new(0.5, -2.2, 0),
}
for name, off in pairs(rest) do
	local s = Rig.R15.parts[name]
	parts[name] = { Name = name, Size = Vector3.new(s[1], s[2], s[3]), CFrame = CFrame.new(off), off = off }
end
local model = {
	Name = "Test",
	FindFirstChild = function(_, n)
		return parts[n]
	end,
	GetAttribute = function()
		return nil
	end,
}
local cloth = ClothTails.new(model, ClothTails.colorsFor(model), 1, {})

local failures = 0
local function check(cond, msg)
	print((cond and "ok   " or "FAIL ") .. msg)
	if not cond then
		failures += 1
	end
end

local dt = 1 / 60
local root = Vector3.new(0, 2.83, 0)
local maxStretch, finite = 0, true
local function frame(vel: Vector3)
	root += vel * dt
	for _, p in pairs(parts) do
		p.CFrame = CFrame.new(root + p.off)
	end
	cloth:update(dt)
	for _, t in ipairs(cloth.tails) do
		for i = 1, t.n do
			local d = (t.pts[i + 1] - t.pts[i]).Magnitude
			if d ~= d or d == math.huge then
				finite = false
			end
			maxStretch = math.max(maxStretch, math.abs(d - t.len) / t.len)
		end
	end
end

local function tipOffset(name)
	for _, t in ipairs(cloth.tails) do
		if t.spec.name == name then
			return t.pts[t.n + 1] - t.pts[1]
		end
	end
	return Vector3.zero
end

for _ = 1, 90 do
	frame(Vector3.zero)
end
local hang = tipOffset("SashA")
check(hang.Y < -1.5, string.format("idle: sash hangs down (tip dy = %.2f)", hang.Y))
for _ = 1, 90 do
	frame(Vector3.new(0, 0, -26)) -- sprint forward (-Z)
end
local run = tipOffset("BandA")
check(run.Z > 0.6, string.format("sprint: headband tail streams behind (tip dz = %.2f)", run.Z))
for _ = 1, 15 do
	frame(Vector3.new(0, 0, -92)) -- dash
end
local dash = tipOffset("SashA")
check(dash.Z > 1.0, string.format("dash: sash trails far behind (tip dz = %.2f)", dash.Z))
for _ = 1, 150 do
	frame(Vector3.zero)
end
local settle = tipOffset("SashA")
check(settle.Y < -1.5, string.format("stop: sash settles back down (tip dy = %.2f)", settle.Y))
check(finite, "all points finite")
check(maxStretch < 0.01, string.format("links stay inextensible (max stretch %.2f%%)", maxStretch * 100))
-- Teleport (section cut / respawn): the tails restart instead of whipping across the map.
root += Vector3.new(500, 0, 0)
frame(Vector3.zero)
check((tipOffset("SashA")).Magnitude < 3, "teleport restarts the tails")
print(failures == 0 and "CLOTH OK" or ("CLOTH FAILED: " .. failures))
