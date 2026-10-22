-- Sanity checks for Combat/HitQuery with the baked swing paths.
-- usage: luaurun hitquery.luau <mock.luau> <src/ReplicatedStorage/AAAMotion> <manifest.txt>
local mock = loadfile(arg[2])()
local AAAMotion = mock.mount("AAAMotion", arg[3], readfile(arg[4]))
local HitQuery = require(AAAMotion.Combat.HitQuery)
local ClipLibrary = require(AAAMotion.Animation.ClipLibrary)

local failures = 0
local function check(cond, msg)
	print((cond and "ok   " or "FAIL ") .. msg)
	if not cond then
		failures += 1
	end
end

local frame = CFrame.new(0, 2.83, 0) -- attacker root at origin, facing -Z
local function cand(name, x, z)
	return { model = name, root = { Position = Vector3.new(x, 2.83, z), CFrame = CFrame.new(x, 2.83, z) } }
end
local candidates = { cand("front", 0.5, -4), cand("behind", 0, 5), cand("far", 0, -20), cand("side", 5.5, -2) }

for _, name in ipairs({ "Light1", "Light2", "Light3", "Light4", "Lunge", "Draw" }) do
	local def = HitQuery.ATTACKS[name]
	local clip = ClipLibrary.get(def.clip)
	local starts = HitQuery.markerTimes(clip, "HitStart")
	local hit = {}
	for _, t in ipairs(starts) do
		local swing = HitQuery.swingAt(clip, t)
		for _, h in ipairs(HitQuery.swingHits(frame, def, swing, t, candidates)) do
			hit[h.model] = h
			check(h.t >= swing.t0 - 1e-3 and h.t <= swing.t1 + 1e-3, string.format("%s: contact t=%.3f inside swing [%.2f, %.2f]", name, h.t, swing.t0, swing.t1))
		end
	end
	check(hit.front ~= nil, name .. " hits the target in front")
	check(hit.far == nil, name .. " misses targets out of reach")
	if name == "Light4" then
		check(hit.behind ~= nil, name .. " (405 deg spin) also catches the target behind")
	else
		check(hit.behind == nil, name .. " misses the target behind")
	end
end

local radial = HitQuery.radialHits(Vector3.new(0, 0, -5), 9, candidates)
local names = {}
for _, h in ipairs(radial) do
	names[h.model] = true
end
check(names.front and names.side and not names.far, "radial slam hits nearby targets only")
check(HitQuery.flinch(CFrame.new(0, 0, -4), Vector3.new(0, 0, 0)) == "HitBack", "flinch from behind -> HitBack")
check(HitQuery.flinch(CFrame.new(0, 0, -4) * CFrame.Angles(0, math.pi, 0), Vector3.new(0, 0, 0)) == "HitFront", "flinch facing attacker -> HitFront")
print(failures == 0 and "HITQUERY OK" or ("HITQUERY FAILED: " .. failures))
