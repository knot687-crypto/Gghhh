--[[
	Local camera feel: trauma shakes, FOV kicks, impact frames, screen flashes and slow motion.
	The camera controller calls CameraFX.update(dt) after placing the camera and applies the
	returned offset (camera space) and FOV delta. Mirrors CameraFX in the preview director.
]]

local Lighting = game:GetService("Lighting")

local Config = require(script.Parent.Parent.Config)
local Recipes = require(script.Parent.Parent.Generated.VFXRecipes)

local SHAKES = Recipes.SHAKES

local CameraFX = {}

local rng = Random.new(99)
local shakes = {}
local kicks = {}
local impact = 0
local impactCooldown = 0
local flashV = 0
local flashColor = Color3.new(1, 1, 1)
local slow: { scale: number, dur: number, age: number }? = nil
local grade: ColorCorrectionEffect? = nil

local function getGrade(): ColorCorrectionEffect
	if grade and grade.Parent then
		return grade
	end
	local g = Instance.new("ColorCorrectionEffect")
	g.Name = "AAAMotionGrade"
	g.Parent = Lighting
	grade = g
	return g
end

function CameraFX.shake(name: string, scale: number?)
	local spec = SHAKES[name]
	if not spec then
		return
	end
	local s = scale or 1
	table.insert(shakes, {
		amp = spec[1] * s,
		freq = spec[2],
		dur = spec[3],
		rot = spec[4] * s,
		age = 0,
		ph = { rng:NextNumber() * 100, rng:NextNumber() * 100, rng:NextNumber() * 100 },
	})
end

function CameraFX.fovKick(deg: number, dur: number?)
	table.insert(kicks, { deg = deg, dur = dur or 0.3, age = 0 })
end

-- Anime-style impact frame: a few frames of stark high-contrast monochrome. One per strike:
-- hits landing in the same beat don't re-trigger it.
function CameraFX.impactFrame(dur: number)
	if impactCooldown > 0 and impact <= 0 then
		return
	end
	impact = math.max(impact, dur)
	impactCooldown = dur + 0.35
end

function CameraFX.flash(strength: number, color: string?)
	flashV = math.max(flashV, strength)
	flashColor = if color then Color3.fromHex(color) else Color3.new(1, 1, 1)
end

function CameraFX.slowmo(scale: number, dur: number)
	slow = { scale = scale, dur = dur, age = 0 }
end

-- Visual time scale (animation + VFX); physics keeps running in real time.
function CameraFX.timeScale(): number
	local s = slow
	if not s then
		return 1
	end
	local k = s.age / s.dur
	if k >= 1 then
		return 1
	end
	return if k < 0.6 then s.scale else s.scale + (1 - s.scale) * ((k - 0.6) / 0.4)
end

-- Returns the camera-space offset CFrame and the FOV delta for this frame.
function CameraFX.update(dt: number): (CFrame, number)
	local ox, oy, rz, rx = 0, 0, 0, 0
	local keep = {}
	for _, s in ipairs(shakes) do
		s.age += dt
		local k = math.max(0, 1 - s.age / s.dur)
		local e = k * k
		local t = s.age * s.freq * math.pi * 2
		ox += math.sin(t + s.ph[1]) * s.amp * e
		oy += math.sin(t * 1.13 + s.ph[2]) * s.amp * e
		rz += math.rad(math.sin(t * 0.9 + s.ph[3]) * s.rot * e)
		rx += math.rad(math.sin(t * 1.07 + s.ph[1]) * s.rot * 0.5 * e)
		if s.age < s.dur then
			table.insert(keep, s)
		end
	end
	shakes = keep
	local fov = 0
	local keepK = {}
	for _, kk in ipairs(kicks) do
		kk.age += dt
		local x = kk.age / kk.dur
		fov += kk.deg * (if x < 0.15 then x / 0.15 else (1 - (x - 0.15) / 0.85) ^ 2)
		if kk.age < kk.dur then
			table.insert(keepK, kk)
		end
	end
	kicks = keepK
	if slow then
		slow.age += dt
		if slow.age >= slow.dur then
			slow = nil
		end
	end

	if Config.Graphics.screenEffects then
		local g = getGrade()
		if impact > 0 then
			g.Saturation = -1
			g.Contrast = 1.6
			g.Brightness = 0.1
			g.TintColor = Color3.fromRGB(255, 248, 240)
		else
			g.Saturation = 0
			g.Contrast = flashV * 0.15
			g.Brightness = flashV * 0.35
			g.TintColor = Color3.new(1, 1, 1):Lerp(flashColor, math.min(flashV, 1) * 0.6)
		end
	end
	impact = math.max(0, impact - dt)
	impactCooldown = math.max(0, impactCooldown - dt)
	flashV = math.max(0, flashV - dt * 3.2)
	return CFrame.new(ox, oy, 0) * CFrame.Angles(rx, 0, rz), fov
end

return CameraFX
