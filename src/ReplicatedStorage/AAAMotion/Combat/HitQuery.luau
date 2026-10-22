--[[
	Hit geometry shared by client prediction, server validation and NPC attacks.

	A swing hits a target when the target's root lies inside the attack's hitbox (relative to the
	attacker's start frame) and the baked blade path passes it; the contact time is the swing
	sample where the blade comes closest to the target's chest, so sparks and flinches land
	exactly when the blade crosses the body.
]]

local Tuning = require(script.Parent.Parent.Generated.Tuning)

local HitQuery = {}

HitQuery.ATTACKS = Tuning.ATTACKS
HitQuery.DEFENSE = Tuning.DEFENSE

export type Candidate = { model: Model, root: BasePart }
export type Hit = { model: Model, root: BasePart, t: number, point: Vector3, dir: Vector3 }

local function v3(a): Vector3
	return Vector3.new(a[1], a[2], a[3])
end

local function closestOnSegment(a: Vector3, b: Vector3, p: Vector3): Vector3
	local ab = b - a
	local len2 = ab:Dot(ab)
	if len2 < 1e-9 then
		return a
	end
	local t = math.clamp((p - a):Dot(ab) / len2, 0, 1)
	return a + ab * t
end

-- Marker times of a given name in a prepared clip.
function HitQuery.markerTimes(clip, name: string): { number }
	local out = {}
	for _, m in ipairs(clip.markers) do
		if m.name == name then
			table.insert(out, m.t)
		end
	end
	return out
end

-- Is `pos` inside the attack's hitbox around `startFrame` (with forgiveness margins)?
function HitQuery.inBox(startFrame: CFrame, def, pos: Vector3, posScale: number?, slack: number?): boolean
	local box = def.hitbox
	if not box then
		return false
	end
	local s = posScale or 1
	local extra = slack or 0
	local rel = startFrame:PointToObjectSpace(pos)
	local o, z = box.offset, box.size
	return math.abs(rel.X - o[1] * s) <= z[1] * s / 2 + 1 + extra
		and math.abs(rel.Z - o[3] * s) <= z[3] * s / 2 + 1 + extra
		and math.abs(rel.Y - o[2] * s) <= z[2] * s / 2 + 2 + extra
end

-- The swing that a SwingStart/HitStart at clip time `t` belongs to.
function HitQuery.swingAt(clip, t: number)
	local best = nil
	for _, s in ipairs(clip.swings or {}) do
		if t >= s.t0 - 1e-3 and t <= s.t1 + 1e-3 then
			best = s
		end
	end
	return best
end

--[[
	Targets of one swing.
	startFrame   attacker's clip origin in world space (root position at clip start, yaw only)
	def          Tuning.ATTACKS entry
	swing        baked swing of the clip (points in start-frame space)
	fromTime     clip time of the HitStart marker
	candidates   { { model, root } } excluding the attacker
]]
function HitQuery.swingHits(startFrame: CFrame, def, swing, fromTime: number, candidates: { Candidate }, posScale: number?): { Hit }
	local s = posScale or 1
	local hits = {}
	if not swing then
		return hits
	end
	local pts = swing.points
	for _, c in ipairs(candidates) do
		local pos = c.root.Position
		if HitQuery.inBox(startFrame, def, pos, s) then
			local chest = pos + Vector3.new(0, 0.6 * s, 0)
			local best, bestD = nil, math.huge
			for i, p in ipairs(pts) do
				if p.t >= fromTime - 0.02 then
					local base = startFrame:PointToWorldSpace(v3(p.base) * s)
					local tip = startFrame:PointToWorldSpace(v3(p.tip) * s)
					local cp = closestOnSegment(base, tip, chest)
					local d = (cp - chest).Magnitude
					if d < bestD then
						local nxt = pts[math.min(i + 1, #pts)]
						local prv = pts[math.max(i - 1, 1)]
						local dir = startFrame:VectorToWorldSpace(v3(nxt.tip) - v3(prv.tip))
						bestD = d
						best = { t = p.t, point = cp, dir = if dir.Magnitude > 1e-4 then dir.Unit else startFrame.LookVector }
					end
				end
			end
			if best then
				table.insert(hits, { model = c.model, root = c.root, t = best.t, point = best.point, dir = best.dir })
			end
		end
	end
	table.sort(hits, function(a, b)
		return a.t < b.t
	end)
	return hits
end

-- Targets around a ground impact (heavy release, aerial slam).
function HitQuery.radialHits(center: Vector3, radius: number, candidates: { Candidate }): { Hit }
	local hits = {}
	for _, c in ipairs(candidates) do
		local p = c.root.Position
		local flat = Vector3.new(p.X - center.X, 0, p.Z - center.Z)
		if flat.Magnitude <= radius and math.abs(p.Y - center.Y) < 8 then
			local dir = if flat.Magnitude > 1e-3 then flat.Unit else Vector3.zAxis
			table.insert(hits, { model = c.model, root = c.root, t = 0, point = p, dir = dir })
		end
	end
	return hits
end

-- Classifies a hit from the victim's point of view.
--   victimFacing  victim root LookVector; toAttacker unit vector from victim to attacker (flat)
function HitQuery.flinch(victimCF: CFrame, attackerPos: Vector3): string
	local to = Vector3.new(attackerPos.X - victimCF.Position.X, 0, attackerPos.Z - victimCF.Position.Z)
	if to.Magnitude < 1e-3 then
		return "HitFront"
	end
	to = to.Unit
	local facing = to:Dot(victimCF.LookVector)
	if facing > 0.5 then
		return "HitFront"
	elseif facing < -0.5 then
		return "HitBack"
	end
	return if to:Dot(victimCF.RightVector) > 0 then "HitRight" else "HitLeft"
end

return HitQuery
