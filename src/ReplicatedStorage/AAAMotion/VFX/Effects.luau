--[[
	Effect recipes (Generated/VFXRecipes EFFECTS) and the primitives they use: particle bursts,
	cross flashes, glints, shockwave rings, point-light pops, ground rocks and cracks.

	Effects.play(name, origin, {
		slash = Vector3?,    -- swing direction at the hit (aligns sparks, slash rings)
		normal = Vector3?,   -- surface/contact normal (block sparks, wall kicks)
		forward = Vector3?,  -- movement direction (dash rings)
		scale = number?,
	})

	Client only. Everything here is cosmetic and local.
]]

local RunService = game:GetService("RunService")

local Config = require(script.Parent.Parent.Config)
local Recipes = require(script.Parent.Parent.Generated.VFXRecipes)
local Util = require(script.Parent.Parent.Util)
local Particles = require(script.Parent.Particles)

local EFFECTS = Recipes.EFFECTS

local Effects = {}

local rng = Random.new(4321)

-- ------------------------------------------------------------------ timed items
type Item = { age: number, life: number, update: (number, number) -> (), done: (() -> ())? }
local items: { Item } = {}
local conn: RBXScriptConnection? = nil
local timeScale = 1

local function step(dt: number)
	local sdt = dt * timeScale
	local keep = {}
	for _, it in ipairs(items) do
		it.age += sdt
		local k = math.min(it.age / it.life, 1)
		it.update(k, it.age)
		if it.age >= it.life then
			if it.done then
				it.done()
			end
		else
			table.insert(keep, it)
		end
	end
	items = keep
end

local function add(life: number, update: (number, number) -> (), done: (() -> ())?)
	if not conn then
		conn = RunService.Heartbeat:Connect(step)
	end
	table.insert(items, { age = 0, life = math.max(life, 1e-3), update = update, done = done })
end
Effects.addTimed = add

function Effects.setTimeScale(s: number)
	timeScale = s
	Particles.setTimeScale(s)
end

local function folder(): Instance
	return require(script.Parent.Parent.Combat.Weapon).localFolder()
end

-- Rotation-only CFrame whose UpVector is `up`.
local function basisWithUp(up: Vector3): CFrame
	local u = up.Unit
	local ref = if math.abs(u.Y) < 0.95 then Vector3.yAxis else Vector3.xAxis
	local x = u:Cross(ref).Unit
	local z = x:Cross(u)
	return CFrame.fromMatrix(Vector3.zero, x, u, z)
end
Effects.basisWithUp = basisWithUp

-- ------------------------------------------------------------------ one-shot emitters
-- Emitters for single-particle primitives (flash, glint, ring), cached by their parameters.
local special: { [string]: ParticleEmitter } = {}

local function specialEmitter(key: string, setup: (ParticleEmitter) -> ()): ParticleEmitter
	local e = special[key]
	if e and e.Parent then
		return e
	end
	local a = Instance.new("Attachment")
	a.Name = "FX1"
	a.Parent = Particles.anchor()
	e = Instance.new("ParticleEmitter")
	e.Enabled = false
	e.Rate = 0
	e.Speed = NumberRange.new(0)
	e.LightEmission = 1
	e.LightInfluence = 0
	e.Brightness = 2
	e.Drag = 0
	e.LockedToPart = false
	e.EmissionDirection = Enum.NormalId.Front
	e.SpreadAngle = Vector2.zero
	e.ZOffset = 1
	setup(e)
	e.Parent = a
	special[key] = e
	return e
end

function Effects.crossFlash(origin: Vector3, size: number, width: number, duration: number, color: string)
	local key = string.format("flash|%.2f|%.2f|%.3f|%s", size, width, duration, color)
	local e = specialEmitter(key, function(em)
		em.Texture = Particles.texture("streak")
		em.Lifetime = NumberRange.new(duration)
		em.Color = ColorSequence.new(Util.color(color))
		em.Size = Util.numberSequenceFn(function(k)
			return size * (if k < 0.25 then math.max(k / 0.25, 0.05) else 1 + (k - 0.25) * 0.4)
		end, 10)
		em.Transparency = Util.numberSequenceFn(function(k)
			return if k < 0.25 then 0 else 1 - (1 - (k - 0.25) / 0.75) ^ 1.5
		end, 10)
		-- Narrow the sprite toward the requested streak width.
		em.Squash = NumberSequence.new(math.clamp(math.log(size / math.max(width * 4, 0.1), 2), 0, 2.5))
	end)
	local att = e.Parent :: Attachment
	att.WorldPosition = origin
	local a0 = rng:NextNumber() * 180
	e.Rotation = NumberRange.new(a0)
	e:Emit(1)
	e.Rotation = NumberRange.new(a0 + 90 + (rng:NextNumber() - 0.5) * 28)
	e:Emit(1)
end

function Effects.glint(origin: Vector3, size: number, duration: number, color: string)
	local key = string.format("glint|%.2f|%.3f|%s", size, duration, color)
	local e = specialEmitter(key, function(em)
		em.Texture = Particles.texture("spark")
		em.Lifetime = NumberRange.new(duration)
		em.Color = ColorSequence.new(Util.color(color))
		em.Size = Util.numberSequenceFn(function(k)
			return size * math.max(math.sin(math.pi * math.min(k * 1.2, 1)), 0.01)
		end, 10)
		em.Transparency = Util.numberSequenceFn(function(k)
			return 1 - math.sin(math.pi * math.min(k * 1.2, 1))
		end, 10)
		local spin = math.deg(1.5) / duration
		em.RotSpeed = NumberRange.new(spin)
	end)
	local att = e.Parent :: Attachment
	att.WorldPosition = origin
	e:Emit(1)
end

-- Expanding shockwave ring. `normal` = ring axis; billboard rings always face the camera.
function Effects.ring(origin: Vector3, normal: Vector3, r0: number, r1: number, thickness: number, duration: number, color: string, billboard: boolean?)
	local key = string.format("ring|%.2f|%.2f|%.2f|%.3f|%s|%s", r0, r1, thickness, duration, color, tostring(billboard))
	local e = specialEmitter(key, function(em)
		em.Texture = Particles.texture("ring")
		em.Lifetime = NumberRange.new(duration)
		em.Color = ColorSequence.new(Util.color(color))
		em.Orientation = if billboard then Enum.ParticleOrientation.FacingCamera else Enum.ParticleOrientation.VelocityPerpendicular
		em.Speed = NumberRange.new(0.02)
		em.ZOffset = 0.5
		em.Size = Util.numberSequenceFn(function(k)
			return 2 * (r0 + (r1 - r0) * (1 - (1 - k) ^ 3))
		end, 12)
		local alpha = math.min(1, thickness * 1.8)
		em.Transparency = Util.numberSequenceFn(function(k)
			return 1 - (1 - k) ^ 1.4 * alpha
		end, 10)
	end)
	local att = e.Parent :: Attachment
	local n = if normal.Magnitude > 1e-4 then normal.Unit else Vector3.yAxis
	att.WorldCFrame = CFrame.lookAt(origin, origin + n)
	e:Emit(1)
end

-- ------------------------------------------------------------------ lights
local lightPool: { PointLight } = {}
function Effects.light(origin: Vector3, color: string, range: number, brightness: number, duration: number)
	if not Config.Graphics.lights then
		return
	end
	local l: PointLight? = nil
	for _, x in ipairs(lightPool) do
		if not x.Enabled then
			l = x
			break
		end
	end
	if not l then
		if #lightPool >= 6 then
			return
		end
		local a = Instance.new("Attachment")
		a.Name = "FXLight"
		a.Parent = Particles.anchor()
		local nl = Instance.new("PointLight")
		nl.Shadows = false
		nl.Enabled = false
		nl.Parent = a
		table.insert(lightPool, nl)
		l = nl
	end
	local light = l :: PointLight
	;(light.Parent :: Attachment).WorldPosition = origin
	light.Color = Util.color(color)
	light.Range = math.min(range, 60)
	light.Enabled = true
	local peak = math.min(brightness * 0.7, 8)
	add(duration, function(k)
		light.Brightness = peak * (1 - k) ^ 2
	end, function()
		light.Enabled = false
	end)
end

-- ------------------------------------------------------------------ ground debris
local function groundBelow(origin: Vector3): (Vector3, Color3, Enum.Material)
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { folder() }
	params.RespectCanCollide = true
	local hit = workspace:Raycast(origin + Vector3.new(0, 2, 0), Vector3.new(0, -8, 0), params)
	if hit then
		local inst = hit.Instance
		if inst:IsA("BasePart") and not inst:IsA("Terrain") then
			return hit.Position, inst.Color, inst.Material
		end
		return hit.Position, Color3.fromRGB(119, 112, 106), Enum.Material.Slate
	end
	return origin, Color3.fromRGB(119, 112, 106), Enum.Material.Slate
end

local function debrisPart(name: string, size: Vector3, color: Color3, material: Enum.Material): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.Color = color
	p.Material = material
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	return p
end

function Effects.rocks(origin: Vector3, count: number, radius: number, size: { number }, duration: number)
	local ground, color, material = groundBelow(origin)
	local model = Instance.new("Model")
	model.Name = "AAARocks"
	local rocks = {}
	for i = 0, count - 1 do
		local a = (i / count) * math.pi * 2 + (rng:NextNumber() - 0.5) * 0.4
		local s = size[1] + (size[2] - size[1]) * rng:NextNumber()
		local dims = Vector3.new(s * (0.8 + rng:NextNumber() * 0.6), s * (1 + rng:NextNumber() * 0.8), s * (0.8 + rng:NextNumber() * 0.6))
		local r = radius * (0.85 + rng:NextNumber() * 0.3)
		local base = ground + Vector3.new(math.cos(a) * r, 0, math.sin(a) * r)
		-- Tilted outward, as if the floor was blasted open.
		local outward = Vector3.new(math.cos(a), 0, math.sin(a))
		local tiltAxis = outward:Cross(Vector3.yAxis)
		local rot = CFrame.fromAxisAngle(tiltAxis, -math.rad(25 + rng:NextNumber() * 25)) * CFrame.Angles(0, rng:NextNumber() * math.pi * 2, 0)
		local part = debrisPart("Rock", dims, color:Lerp(Color3.new(0, 0, 0), rng:NextNumber() * 0.25), material)
		part.CFrame = CFrame.new(base - Vector3.new(0, s, 0)) * rot
		part.Parent = model
		table.insert(rocks, { part = part, base = base, rot = rot, s = s, delay = (r / radius) * 0.05 })
	end
	model.Parent = folder()
	local parts = table.create(#rocks)
	local cfs = table.create(#rocks)
	for i, rk in ipairs(rocks) do
		parts[i] = rk.part
	end
	add(duration, function(_, age)
		for i, rk in ipairs(rocks) do
			local t = math.max(0, age - rk.delay)
			local pop = math.min(t / 0.07, 1)
			local sink = math.max(0, (age - (duration - 0.6)) / 0.6)
			local y = -rk.s + rk.s * 1.25 * (1 - (1 - pop) ^ 3) - sink * rk.s * 1.4
			cfs[i] = CFrame.new(rk.base + Vector3.new(0, y, 0)) * rk.rot
		end
		workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
	end, function()
		model:Destroy()
	end)
end

function Effects.cracks(origin: Vector3, radius: number, duration: number)
	local ground = groundBelow(origin)
	local model = Instance.new("Model")
	model.Name = "AAACracks"
	local pieces = {}
	local tex = Config.Textures.crack
	if tex and tex ~= "" then
		local p = debrisPart("Crack", Vector3.new(radius * 2, 0.05, radius * 2), Color3.new(), Enum.Material.SmoothPlastic)
		p.Transparency = 1
		p.CFrame = CFrame.new(ground + Vector3.new(0, 0.03, 0)) * CFrame.Angles(0, rng:NextNumber() * math.pi * 2, 0)
		local d = Instance.new("Decal")
		d.Texture = tex
		d.Face = Enum.NormalId.Top
		d.Parent = p
		p.Parent = model
		table.insert(pieces, { decal = d })
	else
		-- Procedural fissures: jagged dark slivers radiating from a scorch mark.
		local scorch = debrisPart("Scorch", Vector3.new(0.04, radius * 0.95, radius * 0.95), Color3.fromRGB(22, 21, 22), Enum.Material.Slate)
		scorch.Shape = Enum.PartType.Cylinder
		scorch.CFrame = CFrame.new(ground + Vector3.new(0, 0.02, 0)) * CFrame.Angles(0, 0, math.pi / 2)
		scorch.Transparency = 0.35
		scorch.Parent = model
		table.insert(pieces, { part = scorch, base = 0.35, at = 0 })
		local branches = 12
		for b = 0, branches - 1 do
			local a = (b / branches) * math.pi * 2 + rng:NextNumber() * 0.3
			local len = radius * (0.55 + rng:NextNumber() * 0.45)
			local pos = ground
			local step = radius / 7
			local d = 0
			while d < len do
				a += (rng:NextNumber() - 0.5) * 0.7
				local dir = Vector3.new(math.cos(a), 0, math.sin(a))
				local w = math.max(0.05, 0.24 * (1 - d / len))
				local nxt = pos + dir * step
				local seg = debrisPart("Fissure", Vector3.new(w, 0.03, step + w * 0.5), Color3.fromRGB(14, 13, 14), Enum.Material.SmoothPlastic)
				seg.CFrame = CFrame.lookAt((pos + nxt) / 2 + Vector3.new(0, 0.035, 0), nxt + Vector3.new(0, 0.035, 0))
				seg.Transparency = 1
				seg.Parent = model
				table.insert(pieces, { part = seg, base = 0.05, at = d / radius })
				pos = nxt
				d += step
			end
		end
	end
	model.Parent = folder()
	add(duration, function(k, age)
		local fade = if k < 0.7 then 0 else (k - 0.7) / 0.3
		for _, pc in ipairs(pieces) do
			if pc.decal then
				pc.decal.Transparency = 0.05 + 0.95 * fade
			else
				-- Fissures race outward over the first 0.08 s.
				local shown = age >= pc.at * 0.08
				pc.part.Transparency = if shown then pc.base + (1 - pc.base) * fade else 1
			end
		end
	end, function()
		model:Destroy()
	end)
end

-- ------------------------------------------------------------------ recipes
function Effects.play(name: string, origin: Vector3, opts)
	local recipe = EFFECTS[name]
	if not recipe then
		warn("[AAAMotion] unknown effect", name)
		return
	end
	local o = opts or {}
	local scale = o.scale or 1
	for _, e in ipairs(recipe) do
		local s = scale * (e.sizeScale or 1)
		if e.type == "particles" then
			local dir = nil
			if e.align == "slash" and o.slash then
				dir = o.slash
			elseif e.align == "normal" and o.normal then
				dir = o.normal
			end
			local basis = nil
			if e.plane == "forward" and o.forward then
				basis = basisWithUp(o.forward)
			end
			Particles.emit(e.preset, e.count, origin, {
				dir = dir,
				basis = basis,
				sizeScale = s,
				speedScale = e.speedScale or 1,
				color = e.color,
			})
		elseif e.type == "crossFlash" then
			Effects.crossFlash(origin, e.size * scale, e.width * scale, e.duration, e.color)
		elseif e.type == "ring" then
			local n = Vector3.yAxis
			if e.face == "slash" and o.slash then
				n = o.slash
			elseif e.face == "forward" and o.forward then
				n = o.forward
			elseif e.face == "normal" and o.normal then
				n = o.normal
			end
			Effects.ring(origin, n, e.radius0 * scale, e.radius1 * scale, e.thickness * scale, e.duration, e.color, e.face == "camera")
		elseif e.type == "rocks" then
			Effects.rocks(origin, e.count, e.radius * scale, e.size, e.duration)
		elseif e.type == "cracks" then
			Effects.cracks(origin, e.radius * scale, e.duration)
		elseif e.type == "light" then
			Effects.light(origin, e.color, e.range * scale, e.brightness, e.duration)
		elseif e.type == "glint" then
			Effects.glint(origin, e.size * scale, e.duration, e.color)
		end
	end
end

Effects.emit = Particles.emit

return Effects
