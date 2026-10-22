--[[
	Burst particles driven by the PARTICLES presets in Generated/VFXRecipes (the same presets the
	preview renders, written in ParticleEmitter terms).

	Emitters are pooled per (preset, size scale, colour, alpha) variant because Size, Color and
	Transparency sequences apply to live particles too; Speed and Lifetime are sampled at emission,
	so speed scaling is set right before :Emit(). Ring and sphere shapes are emitted particle by
	particle from a moving attachment.
]]

local Config = require(script.Parent.Parent.Config)
local Recipes = require(script.Parent.Parent.Generated.VFXRecipes)
local Util = require(script.Parent.Parent.Util)

local PRESETS = Recipes.PARTICLES

local Particles = {}

local rng = Random.new(1234)
local anchor: BasePart? = nil
local emitters: { [string]: ParticleEmitter } = {}
local all: { ParticleEmitter } = {}

function Particles.texture(name: string): string
	local id = Config.Textures[name]
	if id and id ~= "" then
		return id
	end
	return Config.FallbackTextures[name] or ""
end

local function getAnchor(): BasePart
	if anchor and anchor.Parent then
		return anchor
	end
	local p = Instance.new("Part")
	p.Name = "AAAMotionFXAnchor"
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.Transparency = 1
	p.Size = Vector3.one
	p.CFrame = CFrame.identity
	p.Parent = require(script.Parent.Parent.Combat.Weapon).localFolder()
	anchor = p
	return p
end
Particles.anchor = getAnchor

local ORIENT = {
	velocityParallel = Enum.ParticleOrientation.VelocityParallel,
	velocityPerpendicular = Enum.ParticleOrientation.VelocityPerpendicular,
	facingUp = Enum.ParticleOrientation.FacingCameraWorldUp,
}

local function build(spec, sizeScale: number, color: string?, alphaScale: number): ParticleEmitter
	local a = Instance.new("Attachment")
	a.Name = "FX"
	a.Parent = getAnchor()
	local e = Instance.new("ParticleEmitter")
	e.Enabled = false
	e.Rate = 0
	e.Texture = Particles.texture(spec.texture)
	e.Lifetime = NumberRange.new(spec.lifetime[1], spec.lifetime[2])
	e.Speed = NumberRange.new(spec.speed[1], spec.speed[2])
	local spread = spec.spread or 0
	e.SpreadAngle = Vector2.new(spread, spread)
	e.Size = Util.numberSequence(spec.size, sizeScale)
	e.Squash = if spec.squash then Util.numberSequence(spec.squash) else NumberSequence.new(0)
	local tr = spec.transparency or 0
	if alphaScale ~= 1 then
		local scaled = {}
		for i, k in ipairs(tr) do
			scaled[i] = { k[1], 1 - (1 - k[2]) * alphaScale }
		end
		tr = scaled
	end
	e.Transparency = Util.numberSequence(tr)
	e.Color = if color then ColorSequence.new(Util.color(color)) else Util.colorSequence(spec.color)
	local glow = (spec.lightEmission or 0) >= 0.5
	e.LightEmission = spec.lightEmission or 0
	e.LightInfluence = if glow then 0 else 1
	e.Brightness = if glow then 1.6 else 1
	e.Drag = spec.drag or 0
	e.Acceleration = Util.v3(spec.acceleration)
	e.Rotation = if spec.rotation then NumberRange.new(spec.rotation[1], spec.rotation[2]) else NumberRange.new(0)
	e.RotSpeed = if spec.rotSpeed then NumberRange.new(spec.rotSpeed[1], spec.rotSpeed[2]) else NumberRange.new(0)
	e.Orientation = ORIENT[spec.orientation or ""] or Enum.ParticleOrientation.FacingCamera
	e.EmissionDirection = Enum.NormalId.Front
	e.LockedToPart = false
	e.VelocityInheritance = 0
	e.ZOffset = if glow then 0.4 else 0
	e.Parent = a
	table.insert(all, e)
	return e
end

local function variant(name: string, sizeScale: number, color: string?, alphaScale: number): ParticleEmitter
	local key = string.format("%s|%.3f|%s|%.2f", name, sizeScale, color or "", alphaScale)
	local e = emitters[key]
	if e and e.Parent then
		return e
	end
	e = build(PRESETS[name], sizeScale, color, alphaScale)
	emitters[key] = e
	return e
end

local function setSpeed(e: ParticleEmitter, spec, speedScale: number)
	e.Speed = NumberRange.new(spec.speed[1] * speedScale, spec.speed[2] * speedScale)
end

--[[
	Emit `count` particles of a preset.
	opts.dir         emission direction (default: basis up)
	opts.basis       CFrame whose rotation orients ring shapes (default: world)
	opts.sizeScale / speedScale / alphaScale / color
]]
function Particles.emit(name: string, count: number, origin: Vector3, opts)
	local spec = PRESETS[name]
	if not spec or count <= 0 then
		return
	end
	local o = opts or {}
	local e = variant(name, o.sizeScale or 1, o.color, o.alphaScale or 1)
	local att = e.Parent :: Attachment
	setSpeed(e, spec, o.speedScale or 1)
	local basis = if o.basis then o.basis.Rotation else CFrame.identity
	if spec.shape == "ring" then
		local r = spec.shapeRadius or 0.5
		for _ = 1, count do
			local ang = rng:NextNumber() * math.pi * 2
			local radial = basis:VectorToWorldSpace(Vector3.new(math.cos(ang), 0, math.sin(ang)))
			local p = origin + radial * r
			att.WorldCFrame = CFrame.lookAt(p, p + radial)
			e:Emit(1)
		end
	elseif spec.shape == "sphere" then
		local r = (spec.shapeRadius or 1) * (o.sizeScale or 1)
		for _ = 1, count do
			local d = Util.cone(rng, Vector3.yAxis, 180)
			local p = origin + d * r
			local dir = if spec.inward then -d else d
			att.WorldCFrame = CFrame.lookAt(p, p + dir)
			e:Emit(1)
		end
	else
		local dir = o.dir or basis.UpVector
		if dir.Magnitude < 1e-4 then
			dir = Vector3.yAxis
		end
		att.WorldCFrame = CFrame.lookAt(origin, origin + dir.Unit)
		e:Emit(count)
	end
end

-- Slow-motion support: scales every pooled emitter's simulation speed.
function Particles.setTimeScale(s: number)
	for _, e in ipairs(all) do
		e.TimeScale = s
	end
end

return Particles
