--[[
	Minimal Roblox environment for running the pure-Luau parts of AAAMotion outside Roblox:
	Vector3, CFrame (Roblox semantics: Angles = Rx*Ry*Rz, geodesic Lerp), a ModuleScript tree
	built from a file manifest, require(), task.spawn and warn.
	Host globals used: loadfile(path) -> function, readfile(path) -> string.
]]

local sqrt, sin, cos, acos = math.sqrt, math.sin, math.cos, math.acos

-- ------------------------------------------------------------------ Vector3
local V = {}
V.__index = function(v, k)
	if k == "X" then
		return rawget(v, 1)
	elseif k == "Y" then
		return rawget(v, 2)
	elseif k == "Z" then
		return rawget(v, 3)
	elseif k == "Magnitude" then
		return sqrt(v[1] * v[1] + v[2] * v[2] + v[3] * v[3])
	elseif k == "Unit" then
		local m = sqrt(v[1] * v[1] + v[2] * v[2] + v[3] * v[3])
		return setmetatable({ v[1] / m, v[2] / m, v[3] / m }, V)
	end
	return V[k]
end
local function vec(x, y, z)
	return setmetatable({ x or 0, y or 0, z or 0 }, V)
end
V.__add = function(a, b)
	return vec(a[1] + b[1], a[2] + b[2], a[3] + b[3])
end
V.__sub = function(a, b)
	return vec(a[1] - b[1], a[2] - b[2], a[3] - b[3])
end
V.__mul = function(a, b)
	if type(a) == "number" then
		return vec(a * b[1], a * b[2], a * b[3])
	elseif type(b) == "number" then
		return vec(a[1] * b, a[2] * b, a[3] * b)
	end
	return vec(a[1] * b[1], a[2] * b[2], a[3] * b[3])
end
V.__div = function(a, b)
	if type(b) == "number" then
		return vec(a[1] / b, a[2] / b, a[3] / b)
	end
	return vec(a[1] / b[1], a[2] / b[2], a[3] / b[3])
end
V.__unm = function(a)
	return vec(-a[1], -a[2], -a[3])
end
V.__eq = function(a, b)
	return a[1] == b[1] and a[2] == b[2] and a[3] == b[3]
end
V.__tostring = function(a)
	return string.format("%g, %g, %g", a[1], a[2], a[3])
end
function V.Dot(a, b)
	return a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
end
function V.Cross(a, b)
	return vec(a[2] * b[3] - a[3] * b[2], a[3] * b[1] - a[1] * b[3], a[1] * b[2] - a[2] * b[1])
end
function V.Lerp(a, b, t)
	return a + (b - a) * t
end

Vector3 = {
	new = vec,
	zero = vec(0, 0, 0),
	one = vec(1, 1, 1),
	xAxis = vec(1, 0, 0),
	yAxis = vec(0, 1, 0),
	zAxis = vec(0, 0, 1),
}

-- ------------------------------------------------------------------ CFrame
-- Stored as { x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22 } (row-major rotation,
-- columns are the right / up / back vectors).
local C = {}
local function cf(x, y, z, a, b, c, d, e, f, g, h, i)
	return setmetatable({ x, y, z, a, b, c, d, e, f, g, h, i }, C)
end
local function rot(m, v)
	return m[4] * v[1] + m[5] * v[2] + m[6] * v[3], m[7] * v[1] + m[8] * v[2] + m[9] * v[3], m[10] * v[1] + m[11] * v[2] + m[12] * v[3]
end
local function mul(a, b)
	local x, y, z = rot(a, { b[1], b[2], b[3] })
	return cf(
		a[1] + x,
		a[2] + y,
		a[3] + z,
		a[4] * b[4] + a[5] * b[7] + a[6] * b[10],
		a[4] * b[5] + a[5] * b[8] + a[6] * b[11],
		a[4] * b[6] + a[5] * b[9] + a[6] * b[12],
		a[7] * b[4] + a[8] * b[7] + a[9] * b[10],
		a[7] * b[5] + a[8] * b[8] + a[9] * b[11],
		a[7] * b[6] + a[8] * b[9] + a[9] * b[12],
		a[10] * b[4] + a[11] * b[7] + a[12] * b[10],
		a[10] * b[5] + a[11] * b[8] + a[12] * b[11],
		a[10] * b[6] + a[11] * b[9] + a[12] * b[12]
	)
end
local function toQuat(m)
	local r00, r01, r02, r10, r11, r12, r20, r21, r22 = m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12]
	local tr = r00 + r11 + r22
	local qx, qy, qz, qw
	if tr > 0 then
		local s = sqrt(tr + 1) * 2
		qw = 0.25 * s
		qx = (r21 - r12) / s
		qy = (r02 - r20) / s
		qz = (r10 - r01) / s
	elseif r00 > r11 and r00 > r22 then
		local s = sqrt(1 + r00 - r11 - r22) * 2
		qw = (r21 - r12) / s
		qx = 0.25 * s
		qy = (r01 + r10) / s
		qz = (r02 + r20) / s
	elseif r11 > r22 then
		local s = sqrt(1 + r11 - r00 - r22) * 2
		qw = (r02 - r20) / s
		qx = (r01 + r10) / s
		qy = 0.25 * s
		qz = (r12 + r21) / s
	else
		local s = sqrt(1 + r22 - r00 - r11) * 2
		qw = (r10 - r01) / s
		qx = (r02 + r20) / s
		qy = (r12 + r21) / s
		qz = 0.25 * s
	end
	return qx, qy, qz, qw
end
local function fromQuat(x, y, z, qx, qy, qz, qw)
	return cf(
		x,
		y,
		z,
		1 - 2 * (qy * qy + qz * qz),
		2 * (qx * qy - qz * qw),
		2 * (qx * qz + qy * qw),
		2 * (qx * qy + qz * qw),
		1 - 2 * (qx * qx + qz * qz),
		2 * (qy * qz - qx * qw),
		2 * (qx * qz - qy * qw),
		2 * (qy * qz + qx * qw),
		1 - 2 * (qx * qx + qy * qy)
	)
end
C.toQuat = toQuat

C.__index = function(m, k)
	if k == "Position" then
		return vec(m[1], m[2], m[3])
	elseif k == "Rotation" then
		return cf(0, 0, 0, m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12])
	elseif k == "X" then
		return m[1]
	elseif k == "Y" then
		return m[2]
	elseif k == "Z" then
		return m[3]
	elseif k == "RightVector" then
		return vec(m[4], m[7], m[10])
	elseif k == "UpVector" then
		return vec(m[5], m[8], m[11])
	elseif k == "LookVector" then
		return vec(-m[6], -m[9], -m[12])
	end
	return C[k]
end
C.__mul = function(a, b)
	if getmetatable(b) == V then
		local x, y, z = rot(a, b)
		return vec(a[1] + x, a[2] + y, a[3] + z)
	end
	return mul(a, b)
end
C.__add = function(a, v)
	return cf(a[1] + v[1], a[2] + v[2], a[3] + v[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12])
end
C.__sub = function(a, v)
	return cf(a[1] - v[1], a[2] - v[2], a[3] - v[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12])
end
C.__eq = function(a, b)
	for i = 1, 12 do
		if a[i] ~= b[i] then
			return false
		end
	end
	return true
end
function C.Inverse(m)
	-- transpose rotation, -R^T p
	local t = cf(0, 0, 0, m[4], m[7], m[10], m[5], m[8], m[11], m[6], m[9], m[12])
	local x, y, z = rot(t, { m[1], m[2], m[3] })
	t[1], t[2], t[3] = -x, -y, -z
	return t
end
function C.VectorToWorldSpace(m, v)
	return vec(rot(m, v))
end
function C.VectorToObjectSpace(m, v)
	return vec(rot(C.Inverse(m), v))
end
function C.PointToWorldSpace(m, v)
	return m * v
end
function C.PointToObjectSpace(m, v)
	return C.Inverse(m) * v
end
-- Geodesic interpolation (quaternion slerp along the shortest arc), linear position.
function C.Lerp(a, b, t)
	local ax, ay, az, aw = toQuat(a)
	local bx, by, bz, bw = toQuat(b)
	local d = ax * bx + ay * by + az * bz + aw * bw
	if d < 0 then
		d, bx, by, bz, bw = -d, -bx, -by, -bz, -bw
	end
	local k0, k1
	if d > 0.999999 then
		k0, k1 = 1 - t, t
	else
		local th = acos(math.min(d, 1))
		local s = sin(th)
		k0, k1 = sin((1 - t) * th) / s, sin(t * th) / s
	end
	local qx, qy, qz, qw = ax * k0 + bx * k1, ay * k0 + by * k1, az * k0 + bz * k1, aw * k0 + bw * k1
	local n = sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
	return fromQuat(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, qx / n, qy / n, qz / n, qw / n)
end

-- Roblox returns the rotation's unit axis and its angle in [0, pi].
function C.ToAxisAngle(m)
	local qx, qy, qz, qw = toQuat(m)
	if qw < 0 then
		qx, qy, qz, qw = -qx, -qy, -qz, -qw
	end
	local s = sqrt(qx * qx + qy * qy + qz * qz)
	if s < 1e-12 then
		return vec(1, 0, 0), 0
	end
	return vec(qx / s, qy / s, qz / s), 2 * math.atan2(s, qw)
end

local function angles(rx, ry, rz)
	local cx, sx, cy, sy, cz, sz = cos(rx), sin(rx), cos(ry), sin(ry), cos(rz), sin(rz)
	local X = cf(0, 0, 0, 1, 0, 0, 0, cx, -sx, 0, sx, cx)
	local Y = cf(0, 0, 0, cy, 0, sy, 0, 1, 0, -sy, 0, cy)
	local Z = cf(0, 0, 0, cz, -sz, 0, sz, cz, 0, 0, 0, 1)
	return mul(mul(X, Y), Z)
end

CFrame = {
	identity = cf(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1),
	new = function(x, y, z)
		if x == nil then
			return cf(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1)
		elseif type(x) ~= "number" then
			return cf(x[1], x[2], x[3], 1, 0, 0, 0, 1, 0, 0, 0, 1)
		end
		return cf(x, y, z, 1, 0, 0, 0, 1, 0, 0, 0, 1)
	end,
	Angles = angles,
	fromEulerAnglesXYZ = angles,
	fromMatrix = function(p, x, y, z)
		z = z or x:Cross(y)
		return cf(p[1], p[2], p[3], x[1], y[1], z[1], x[2], y[2], z[2], x[3], y[3], z[3])
	end,
	fromQuat = fromQuat,
	toQuat = toQuat,
	fromAxisAngle = function(v, a)
		local m = sqrt(v[1] * v[1] + v[2] * v[2] + v[3] * v[3])
		local k = sin(a / 2) / m
		return fromQuat(0, 0, 0, v[1] * k, v[2] * k, v[3] * k, cos(a / 2))
	end,
}

-- ------------------------------------------------------------------ instances & require
local Inst = {}
Inst.__index = function(t, k)
	local m = rawget(Inst, k)
	if m then
		return m
	end
	local c = rawget(t, "_children")[k]
	if c then
		return c
	end
	error(string.format("%s is not a valid member of %s", tostring(k), rawget(t, "Name")), 2)
end
function Inst.FindFirstChild(t, name)
	return rawget(t, "_children")[name]
end
function Inst.WaitForChild(t, name)
	local c = rawget(t, "_children")[name]
	assert(c, "infinite yield on " .. name)
	return c
end
function Inst.GetChildren(t)
	local out = {}
	for _, c in pairs(rawget(t, "_children")) do
		table.insert(out, c)
	end
	return out
end
function Inst.IsA(t, class)
	return rawget(t, "ClassName") == class
end

local function node(name, class, parent)
	local n = setmetatable({ Name = name, ClassName = class, Parent = parent, _children = {} }, Inst)
	if parent then
		rawget(parent, "_children")[name] = n
	end
	return n
end

-- Builds a Rojo-style tree under a Folder from "relative/path.luau" entries (init.luau makes
-- its directory a ModuleScript).
local function mount(rootName, base, manifest)
	local root = node(rootName, "Folder", nil)
	local dirs = { [""] = root }
	local function dir(path)
		if dirs[path] then
			return dirs[path]
		end
		local parentPath, name = string.match(path, "^(.*)/([^/]+)$")
		if not parentPath then
			parentPath, name = "", path
		end
		local d = node(name, "Folder", dir(parentPath))
		dirs[path] = d
		return d
	end
	for line in string.gmatch(manifest, "[^\n]+") do
		local d, file = string.match(line, "^(.*)/([^/]+)%.luau$")
		if not d then
			d, file = "", string.match(line, "^([^/]+)%.luau$")
		end
		local full = base .. "/" .. line
		if file == "init" then
			local m = dir(d)
			rawset(m, "ClassName", "ModuleScript")
			rawset(m, "_path", full)
		else
			local m = node(file, "ModuleScript", dir(d))
			rawset(m, "_path", full)
		end
	end
	return root
end

local cache = {}
function require(m)
	local c = cache[m]
	if c ~= nil then
		return c
	end
	local path = rawget(m, "_path")
	assert(path, "not a module: " .. tostring(rawget(m, "Name")))
	local f = loadfile(path)
	setfenv(f, setmetatable({ script = m }, { __index = _G }))
	local v = f()
	cache[m] = v
	return v
end

task = {
	spawn = function(f, ...)
		f(...)
	end,
	delay = function() end,
}
warn = function(...)
	print("WARN", ...)
end

return { mount = mount, vec = vec, CFrame = CFrame }
