--[[
	Cloth tails: a hachimaki headband and the obi knot, each trailing two simulated tails that
	swing with the body, stream behind dashes and settle when still (secondary motion).
	Roblox twin of tools/preview/web/src/cloth.js; the spec lives in Generated/Cloth.

	Each tail is a chain pinned at its knot, integrated with gravity and air drag in sub-steps,
	kept inextensible with follow-the-leader constraints (plus the DFTL velocity correction),
	straightened a little at the knot and between links, fluttered by speed and pushed out of
	capsules around the body. Tails are local, anchored, non-colliding parts moved in one
	BulkMoveTo per character; the band is welded to the head.

	Update after physics (PostSimulation), when the parts already show this frame's pose.
]]

local AAAMotion = script.Parent.Parent
local Config = require(AAAMotion.Config)
local Rig = require(AAAMotion.Generated.Rig)
local Spec = require(AAAMotion.Generated.Cloth)

local ClothTails = {}
ClothTails.__index = ClothTails

local STANDARD = Rig.R15.parts
local FAR = CFrame.new(0, -10000, 0)

local function v3(t): Vector3
	return Vector3.new(t[1], t[2], t[3])
end

local function newPart(name: string, color: Color3): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = true
	p.Material = Enum.Material.Fabric
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Color = color
	return p
end

-- Part-space point scaled from the standard R15 part to this rig's part.
local function scaledPoint(part: BasePart, t): Vector3
	local std = STANDARD[part.Name]
	local s = if std then Vector3.new(part.Size.X / std[1], part.Size.Y / std[2], part.Size.Z / std[3]) else Vector3.one
	return v3(t) * s
end

local function pushOutOfCapsule(p: Vector3, a: Vector3, b: Vector3, r: number): Vector3
	local ab = b - a
	local L2 = ab:Dot(ab)
	local t = if L2 > 1e-9 then math.clamp((p - a):Dot(ab) / L2, 0, 1) else 0
	local c = a + ab * t
	local d = p - c
	local m = d.Magnitude
	if m >= r then
		return p
	end
	if m < 1e-6 then
		return c + Vector3.zAxis * r
	end
	return c + d * (r / m)
end

function ClothTails.new(model: Model, colors: { sash: Color3, band: Color3 }, scale: number, folder: Instance)
	local self = setmetatable({}, ClothTails)
	self.model = model
	self.scale = scale
	self.time = 0
	self.parts = {}
	self.tails = {}
	for _, spec in ipairs(Spec.tails) do
		local part = model:FindFirstChild(spec.part) :: BasePart?
		if part then
			local n = spec.segments
			local tail = {
				spec = spec,
				part = part,
				n = n,
				len = spec.length * scale / n,
				width = spec.width * scale,
				anchorLocal = scaledPoint(part, spec.anchor),
				dirLocal = v3(spec.dir).Unit,
				pts = table.create(n + 1, Vector3.zero),
				vel = table.create(n + 1, Vector3.zero),
				segs = {},
				init = false,
			}
			local color = if spec.color == "band" then colors.band else colors.sash
			for i = 1, n do
				local seg = newPart(model.Name .. "_" .. spec.name .. i, color)
				local w = tail.width * (1 - 0.3 * ((i - 0.5) / n))
				seg.Size = Vector3.new(w, 0.05 * scale, tail.len * 1.04)
				seg.CFrame = FAR
				seg.Parent = folder
				table.insert(tail.segs, seg)
				table.insert(self.parts, seg)
			end
			table.insert(self.tails, tail)
		end
	end

	local head = model:FindFirstChild(Spec.band.part) :: BasePart?
	if head then
		local b = Spec.band
		local std = STANDARD[b.part]
		local d = math.max(head.Size.X, head.Size.Z) * (b.size[1] / std[1])
		local band = newPart("AAABand", colors.band)
		band.Anchored = false
		band.Massless = true
		band.Shape = Enum.PartType.Cylinder
		band.Size = Vector3.new(b.size[2] * head.Size.Y / std[2], d, d)
		local weld = Instance.new("Weld")
		weld.Part0 = head
		weld.Part1 = band
		weld.C0 = CFrame.new(scaledPoint(head, b.offset)) * CFrame.Angles(0, 0, math.rad(90))
		weld.Parent = band
		band.CFrame = head.CFrame * weld.C0
		band.Parent = model
		self.band = band
	end

	self.colliders = {}
	for _, c in ipairs(Spec.colliders) do
		local part = model:FindFirstChild(c.part) :: BasePart?
		if part then
			table.insert(self.colliders, { part = part, a = scaledPoint(part, c.a), b = scaledPoint(part, c.b), r = c.r * scale })
		end
	end
	self.hidden = false
	return self
end

function ClothTails:setHidden(hidden: boolean)
	if hidden == self.hidden then
		return
	end
	self.hidden = hidden
	if self.band then
		self.band.Transparency = if hidden then 1 else 0
	end
	if hidden then
		local cfs = table.create(#self.parts, FAR)
		workspace:BulkMoveTo(self.parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
		for _, t in ipairs(self.tails) do
			t.init = false
		end
	end
end

local function step(self, t, dt: number, colliders)
	local C = Spec
	local sub = C.substeps
	local h = dt / sub
	local decay = math.exp(-C.drag * h)
	local speed = (t.anchor - t.prevAnchor).Magnitude / dt
	local n = t.n
	local p = t.pts
	local vel = t.vel
	local q = table.create(n + 1, Vector3.zero)
	local corr = table.create(n + 2, Vector3.zero)
	local gravity = Vector3.new(0, -C.gravity * self.scale * h, 0)
	for s = 1, sub do
		local k = s / sub
		local A = t.prevAnchor:Lerp(t.anchor, k)
		local D = t.prevDir:Lerp(t.dir, k).Unit
		local time = self.time + h * s
		-- Predict.
		for i = 2, n + 1 do
			local w = math.sin(time * (9 + speed * 0.25) - (i - 1) * 0.9) * C.flutter * speed * ((i - 1) / n) * h
			local v = (vel[i] + gravity + t.side * w) * decay
			vel[i] = v
			q[i] = p[i] + v * h
		end
		q[1] = A
		-- Knot stiffness and bending.
		q[2] = q[2]:Lerp(A + D * t.len, C.rootStiffness)
		for i = 3, n + 1 do
			local back = q[i - 1] - q[i - 2]
			local target = q[i - 1] + (if back.Magnitude > 1e-6 then back.Unit else D) * t.len
			q[i] = q[i]:Lerp(target, C.bend)
		end
		-- Body collisions.
		for i = 2, n + 1 do
			local x = q[i]
			for _, c in ipairs(colliders) do
				x = pushOutOfCapsule(x, c.wa, c.wb, c.r)
			end
			q[i] = x
		end
		-- Follow the leader (inextensible), remembering each correction.
		for i = 2, n + 1 do
			local d = q[i] - q[i - 1]
			local m = d.Magnitude
			local target = q[i - 1] + (if m > 1e-6 then d / m else D) * t.len
			corr[i] = target - q[i]
			q[i] = target
		end
		-- Velocities with the DFTL correction, then commit.
		for i = 2, n + 1 do
			local v = (q[i] - p[i]) / h
			if i <= n then
				v -= corr[i + 1] * (C.dampCorrection / h)
			end
			vel[i] = v
			p[i] = q[i]
		end
		p[1] = A
	end
end

-- dt: animation time this frame (already scaled for slow motion / hit-stop).
function ClothTails:update(dt: number)
	if self.hidden then
		return
	end
	local colliders = {}
	for _, c in ipairs(self.colliders) do
		local cf = c.part.CFrame
		table.insert(colliders, { wa = cf * c.a, wb = cf * c.b, r = c.r })
	end
	local parts, cfs = {}, {}
	for _, t in ipairs(self.tails) do
		local cf = t.part.CFrame
		t.anchor = cf * t.anchorLocal
		t.dir = cf:VectorToWorldSpace(t.dirLocal)
		t.side = cf.RightVector
		local jump = if t.init then (t.anchor - t.prevAnchor).Magnitude else math.huge
		if not t.init or jump > Spec.resetDistance * self.scale then
			for i = 1, t.n + 1 do
				t.pts[i] = t.anchor + t.dir * (t.len * (i - 1))
				t.vel[i] = Vector3.zero
			end
			t.prevAnchor = t.anchor
			t.prevDir = t.dir
			t.init = true
		end
		if dt > 0 then
			step(self, t, dt, colliders)
		end
		t.prevAnchor = t.anchor
		t.prevDir = t.dir
		-- One flat part per link: X across the tail, Z along it.
		for i = 1, t.n do
			local a, b = t.pts[i], t.pts[i + 1]
			local along = b - a
			along = if along.Magnitude > 1e-6 then along.Unit else -Vector3.yAxis
			local across = t.side - along * t.side:Dot(along)
			across = if across.Magnitude > 1e-6 then across.Unit else Vector3.xAxis
			local up = along:Cross(across)
			table.insert(parts, t.segs[i])
			table.insert(cfs, CFrame.fromMatrix((a + b) * 0.5, across, up, along))
		end
	end
	self.time += dt
	if #parts > 0 then
		workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
	end
end

function ClothTails:destroy()
	for _, p in ipairs(self.parts) do
		p:Destroy()
	end
	if self.band then
		self.band:Destroy()
	end
end

-- Colors for a character: model attributes AAA_ClothSash / AAA_ClothBand override the defaults.
function ClothTails.colorsFor(model: Model)
	local cfg = Config.Cloth
	local sash = model:GetAttribute("AAA_ClothSash")
	local band = model:GetAttribute("AAA_ClothBand")
	return {
		sash = if typeof(sash) == "Color3" then sash else Color3.fromHex(cfg.sash),
		band = if typeof(band) == "Color3" then band else Color3.fromHex(cfg.band),
	}
end

return ClothTails
