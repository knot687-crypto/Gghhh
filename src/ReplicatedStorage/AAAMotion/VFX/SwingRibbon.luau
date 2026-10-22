--[[
	Slash ribbons built from the swing paths baked into each attack clip (clip.swings).

	A baked swing is a list of { t, base, tip } blade samples in the action's start frame
	(HumanoidRootPart position + yaw at the start of the clip, or the camera for first-person
	clips), resampled by tip arc length. Samples are revealed as the clip clock passes them, so
	the arc is smooth at any frame rate and never lags behind the blade.

	Geometry: three bands across the blade (soft tail -> bright edge -> white-hot core) drawn as
	triangle pairs (two WedgeParts per triangle). Older samples fade and thin toward the cutting
	edge, giving the crescent shape.
]]

local RunService = game:GetService("RunService")

local Config = require(script.Parent.Parent.Config)
local Recipes = require(script.Parent.Parent.Generated.VFXRecipes)

local RIBBON = Recipes.RIBBON

local SwingRibbon = {}

-- { from, to, alpha, colour } across the swept band (0 = inner edge, 1 = blade tip).
local BANDS = {
	{ 0.58, 0.85, 0.12, "tail" },
	{ 0.85, 0.965, 0.46, "edge" },
	{ 0.965, 1.0, 0.85, "core" },
}

local COLORS = {
	core = Color3.fromHex(RIBBON.coreColor),
	edge = Color3.fromHex(RIBBON.edgeColor),
	tail = Color3.fromHex(RIBBON.tailColor):Lerp(Color3.fromHex(RIBBON.edgeColor), 0.35),
	heavy = Color3.fromHex(RIBBON.heavyColor),
}
local TAIL = Color3.fromHex(RIBBON.tailColor)

local THICK = 0.02
local HIDDEN = CFrame.new(0, -1e5, 0)

-- ------------------------------------------------------------------ wedge pool
local pool: { WedgePart } = {}
local poolFolder: Folder? = nil

local function getFolder(): Folder
	if poolFolder and poolFolder.Parent then
		return poolFolder
	end
	local f = Instance.new("Folder")
	f.Name = "AAARibbons"
	f.Parent = require(script.Parent.Parent.Combat.Weapon).localFolder()
	poolFolder = f
	return f
end

local function acquire(n: number): { WedgePart }
	local out = table.create(n)
	for i = 1, n do
		local w = table.remove(pool)
		if not w then
			w = Instance.new("WedgePart")
			w.Anchored = true
			w.CanCollide = false
			w.CanQuery = false
			w.CanTouch = false
			w.CastShadow = false
			w.Material = Enum.Material.Neon
			w.TopSurface = Enum.SurfaceType.Smooth
			w.BottomSurface = Enum.SurfaceType.Smooth
			w.Size = Vector3.new(THICK, 0.1, 0.1)
			w.CFrame = HIDDEN
			w.Parent = getFolder()
		end
		w.Transparency = 1
		out[i] = w
	end
	return out
end

local function release(list: { WedgePart })
	local cfs = table.create(#list, HIDDEN)
	workspace:BulkMoveTo(list, cfs, Enum.BulkMoveMode.FireCFrameChanged)
	for _, w in ipairs(list) do
		w.Transparency = 1
		table.insert(pool, w)
	end
end

-- ------------------------------------------------------------------ triangles
-- Two right-angled wedges covering triangle abc. Writes into the parallel arrays at index i, i+1.
local function triangle(a: Vector3, b: Vector3, c: Vector3, sizes, cfs, i: number): boolean
	local ab, ac, bc = b - a, c - a, c - b
	local abd, acd, bcd = ab:Dot(ab), ac:Dot(ac), bc:Dot(bc)
	if abd > acd and abd > bcd then
		c, a = a, c
	elseif acd > bcd and acd > abd then
		a, b = b, a
	end
	ab, ac, bc = b - a, c - a, c - b
	local cross = ac:Cross(ab)
	if cross.Magnitude < 1e-7 or bc.Magnitude < 1e-5 then
		return false
	end
	local right = cross.Unit
	local up = bc:Cross(right).Unit
	local back = bc.Unit
	local height = math.abs(ab:Dot(up))
	sizes[i] = Vector3.new(THICK, height, math.abs(ab:Dot(back)))
	cfs[i] = CFrame.fromMatrix((a + b) / 2, right, up, back)
	sizes[i + 1] = Vector3.new(THICK, height, math.abs(ac:Dot(back)))
	cfs[i + 1] = CFrame.fromMatrix((a + c) / 2, -right, up, -back)
	return true
end

-- ------------------------------------------------------------------ ribbons
local active = {}
local conn: RBXScriptConnection? = nil

local function v3(a): Vector3
	return Vector3.new(a[1], a[2], a[3])
end

-- Resamples the baked points to `m` samples (they are already spaced by tip arc length).
local function resample(points, m: number, scale: number)
	local n = #points
	local out = table.create(m)
	for j = 0, m - 1 do
		local u = j / (m - 1) * (n - 1)
		local i = math.min(math.floor(u), n - 2)
		local f = u - i
		local p0, p1 = points[i + 1], points[i + 2]
		out[j + 1] = {
			t = p0.t + (p1.t - p0.t) * f,
			base = v3(p0.base):Lerp(v3(p1.base), f) * scale,
			tip = v3(p0.tip):Lerp(v3(p1.tip), f) * scale,
		}
	end
	return out
end

local function update()
	local keep = {}
	for _, rb in ipairs(active) do
		local t = rb.clock()
		local frame: CFrame = rb.frame()
		local pts = rb.points
		local n = #pts
		local life = rb.life
		-- Reveal samples whose time has passed.
		local shown = 0
		for i = 1, n do
			if pts[i].t <= t then
				shown = i
			else
				break
			end
		end
		local sizes, cfs, parts = rb.sizes, rb.cfs, rb.parts
		-- Per-sample cross-sections.
		local rows = rb.rows
		local fades = rb.fades
		local ks = rb.ks
		for i = 1, shown do
			local p = pts[i]
			local k = math.clamp((t - p.t) / life, 0, 1)
			ks[i] = k
			fades[i] = (1 - k) ^ 2.4
			local width = math.max(0.06, (1 - k) ^ 0.9)
			local tip = frame:PointToWorldSpace(p.tip)
			local base = frame:PointToWorldSpace(p.base)
			local inner = tip:Lerp(base, width)
			local r = rows[i]
			r[1] = inner:Lerp(tip, BANDS[1][1])
			r[2] = inner:Lerp(tip, BANDS[2][1])
			r[3] = inner:Lerp(tip, BANDS[3][1])
			r[4] = tip
		end
		local slot = 0
		for i = 1, shown - 1 do
			local fade = (fades[i] + fades[i + 1]) * 0.5
			local k = (ks[i] + ks[i + 1]) * 0.5
			local r0, r1 = rows[i], rows[i + 1]
			for b = 1, 3 do
				local band = BANDS[b]
				local base = slot + 1
				slot += 4
				local alpha = band[3] * fade * rb.boost
				if alpha < 0.01 then
					for j = base, base + 3 do
						cfs[j] = HIDDEN
						sizes[j] = nil
					end
				else
					local A, B, C, D = r0[b], r0[b + 1], r1[b], r1[b + 1]
					local ok1 = triangle(A, B, C, sizes, cfs, base)
					local ok2 = triangle(B, D, C, sizes, cfs, base + 2)
					if not ok1 then
						cfs[base], cfs[base + 1] = HIDDEN, HIDDEN
						sizes[base], sizes[base + 1] = nil, nil
					end
					if not ok2 then
						cfs[base + 2], cfs[base + 3] = HIDDEN, HIDDEN
						sizes[base + 2], sizes[base + 3] = nil, nil
					end
					local color = rb.colors[b]:Lerp(TAIL, k * 0.8)
					local transparency = 1 - math.min(alpha, 0.95)
					for j = base, base + 3 do
						local w = parts[j]
						w.Transparency = transparency
						w.Color = color
					end
				end
			end
		end
		-- Hide wedges for quads not revealed yet.
		for j = slot + 1, #parts do
			cfs[j] = HIDDEN
			sizes[j] = nil
		end
		for j = 1, #parts do
			local sz = sizes[j]
			if sz then
				parts[j].Size = sz
			elseif cfs[j] == HIDDEN then
				parts[j].Transparency = 1
			end
		end
		workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
		local last = pts[n]
		if shown == n and t - last.t > life * 1.2 or rb.stopped then
			release(parts)
		else
			table.insert(keep, rb)
		end
	end
	active = keep
	if #active == 0 and conn then
		conn:Disconnect()
		conn = nil
	end
end

--[[
	Starts a ribbon.
	swing     baked swing { t0, t1, kind, points = { { t, base, tip } } }
	frame     () -> CFrame   start frame in world space (re-evaluated each frame; constant for
	                          third person, the camera/viewmodel frame for first person)
	clock     () -> number   current clip time
	opts      { heavy: boolean?, scale: number? }
]]
function SwingRibbon.start(swing, frame: () -> CFrame, clock: () -> number, opts)
	if Config.Graphics.ribbonMode ~= "Wedge" or not swing.points or #swing.points < 2 then
		return nil
	end
	local o = opts or {}
	local m = math.clamp(Config.Graphics.ribbonSegments or 20, 6, 40)
	local points = resample(swing.points, m, o.scale or 1)
	local nParts = (m - 1) * 3 * 4
	local heavy = o.heavy == true
	local rb = {
		points = points,
		frame = frame,
		clock = clock,
		life = RIBBON.life * (if heavy then 1.5 else 1),
		boost = if heavy then 1.2 else 1,
		colors = { COLORS.tail, if heavy then COLORS.heavy else COLORS.edge, COLORS.core },
		parts = acquire(nParts),
		sizes = table.create(nParts),
		cfs = table.create(nParts, HIDDEN),
		rows = {},
		fades = {},
		ks = {},
		stopped = false,
	}
	for i = 1, m do
		rb.rows[i] = {}
	end
	table.insert(active, rb)
	if not conn then
		conn = RunService.PreRender:Connect(update)
	end
	return rb
end

function SwingRibbon.stop(rb)
	if rb then
		rb.stopped = true
	end
end

return SwingRibbon
