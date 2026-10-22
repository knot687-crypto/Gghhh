--[[
	Small shared helpers: data-table conversions (the generated modules store plain arrays and hex
	colours), angles and a deterministic RNG.
]]

local Util = {}

local rad = math.rad

function Util.v3(a: { number }?): Vector3
	if not a then
		return Vector3.zero
	end
	return Vector3.new(a[1], a[2], a[3])
end

function Util.color(hex: string): Color3
	return Color3.fromHex(hex)
end

-- CFrame from generated { x, y, z } position and optional { rx, ry, rz } degrees (Euler XYZ).
function Util.cframe(p: { number }?, r: { number }?): CFrame
	local cf = if p then CFrame.new(p[1], p[2], p[3]) else CFrame.identity
	if r then
		cf *= CFrame.Angles(rad(r[1]), rad(r[2]), rad(r[3]))
	end
	return cf
end

-- NumberSequence from { { t, v }, ... } or a constant; pads the 0 and 1 endpoints.
function Util.numberSequence(seq, scale: number?): NumberSequence
	local s = scale or 1
	if type(seq) == "number" then
		return NumberSequence.new(seq * s)
	end
	local kps = {}
	if seq[1][1] > 0 then
		table.insert(kps, NumberSequenceKeypoint.new(0, seq[1][2] * s))
	end
	for _, k in ipairs(seq) do
		table.insert(kps, NumberSequenceKeypoint.new(math.clamp(k[1], 0, 1), k[2] * s))
	end
	if seq[#seq][1] < 1 then
		table.insert(kps, NumberSequenceKeypoint.new(1, seq[#seq][2] * s))
	end
	return NumberSequence.new(kps)
end

-- NumberSequence sampled from a function on [0, 1] (max 20 keypoints).
function Util.numberSequenceFn(fn: (number) -> number, n: number?): NumberSequence
	local count = math.clamp(n or 12, 2, 20)
	local kps = table.create(count)
	for i = 0, count - 1 do
		local t = i / (count - 1)
		kps[i + 1] = NumberSequenceKeypoint.new(t, fn(t))
	end
	return NumberSequence.new(kps)
end

-- ColorSequence from { { t, "#hex" }, ... } or a single hex string.
function Util.colorSequence(seq): ColorSequence
	if type(seq) == "string" then
		return ColorSequence.new(Color3.fromHex(seq))
	end
	local kps = {}
	if seq[1][1] > 0 then
		table.insert(kps, ColorSequenceKeypoint.new(0, Color3.fromHex(seq[1][2])))
	end
	for _, k in ipairs(seq) do
		table.insert(kps, ColorSequenceKeypoint.new(math.clamp(k[1], 0, 1), Color3.fromHex(k[2])))
	end
	if seq[#seq][1] < 1 then
		table.insert(kps, ColorSequenceKeypoint.new(1, Color3.fromHex(seq[#seq][2])))
	end
	return ColorSequence.new(kps)
end

-- Yaw (radians) of a horizontal direction; 0 = facing -Z like a default CFrame.
function Util.yawOf(v: Vector3): number
	return math.atan2(-v.X, -v.Z)
end

function Util.forwardOf(yaw: number): Vector3
	return Vector3.new(-math.sin(yaw), 0, -math.cos(yaw))
end

function Util.rightOf(yaw: number): Vector3
	return Vector3.new(math.cos(yaw), 0, -math.sin(yaw))
end

function Util.angleDiff(a: number, b: number): number
	local d = b - a
	return math.atan2(math.sin(d), math.cos(d))
end

function Util.flat(v: Vector3): Vector3
	return Vector3.new(v.X, 0, v.Z)
end

function Util.unitOr(v: Vector3, fallback: Vector3): Vector3
	if v.Magnitude < 1e-5 then
		return fallback
	end
	return v.Unit
end

-- Frame-rate independent exponential approach.
function Util.damp(cur: number, target: number, rate: number, dt: number): number
	return cur + (target - cur) * (1 - math.exp(-rate * dt))
end

-- Random unit vector within `deg` degrees of `dir`.
function Util.cone(rng: Random, dir: Vector3, deg: number): Vector3
	local cosMax = math.cos(rad(math.min(deg, 180)))
	local cz = cosMax + (1 - cosMax) * rng:NextNumber()
	local sz = math.sqrt(math.max(0, 1 - cz * cz))
	local phi = rng:NextNumber() * math.pi * 2
	local a = if math.abs(dir.Y) < 0.95 then Vector3.yAxis else Vector3.xAxis
	local u = dir:Cross(a).Unit
	local v = dir:Cross(u)
	return (dir * cz + u * (math.cos(phi) * sz) + v * (math.sin(phi) * sz)).Unit
end

-- CFrame at `pos` looking along `dir`; safe when `dir` is vertical (lookAt's default up axis).
function Util.lookAlong(pos: Vector3, dir: Vector3): CFrame
	local d = if dir.Magnitude > 1e-6 then dir.Unit else Vector3.zAxis
	local up = if math.abs(d.Y) > 0.99 then Vector3.xAxis else Vector3.yAxis
	return CFrame.lookAt(pos, pos + d, up)
end

function Util.lerp(a: number, b: number, t: number): number
	return a + (b - a) * t
end

-- Shallow-merges tables left to right into a new table.
function Util.merge(...)
	local out = {}
	for i = 1, select("#", ...) do
		local t = select(i, ...)
		if t then
			for k, v in pairs(t) do
				out[k] = v
			end
		end
	end
	return out
end

return Util
