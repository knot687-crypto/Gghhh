--[[
	Loads generated clips and samples them into per-joint CFrames.

	A sampled joint transform is CFrame.new(px, py, pz) * CFrame.Angles(rad(rx), rad(ry), rad(rz)),
	matching Motor6D.Transform semantics (and the preview's quaternion maths exactly).
	Virtual joints ("RootMotion", "Camera") are sampled too; RigBinding ignores them.
]]

local Curve = require(script.Parent.Curve)
local Clips = require(script.Parent.Parent.Generated.Clips)

local rad = math.rad
local evalCurve = Curve.eval

export type Prepared = {
	name: string,
	data: any,
	length: number,
	loop: boolean,
	additive: boolean,
	joints: { any },
	owns: { [string]: boolean },
	markers: { any },
	meta: { [string]: any },
	swings: { any }?,
}

local ClipLibrary = {}

local prepared: { [string]: Prepared } = {}

local function prepare(data): Prepared
	local joints = {}
	local owns = {}
	for jointName, chans in pairs(data.tracks) do
		owns[jointName] = true
		table.insert(joints, {
			name = jointName,
			rx = chans.rx,
			ry = chans.ry,
			rz = chans.rz,
			px = chans.px,
			py = chans.py,
			pz = chans.pz,
		})
	end
	return {
		name = data.name,
		data = data,
		length = data.length,
		loop = data.loop,
		additive = data.additive,
		joints = joints,
		owns = owns,
		markers = data.markers or {},
		meta = data.meta or {},
		swings = data.swings,
	}
end

-- Returns the prepared clip (cached) or nil if it does not exist.
function ClipLibrary.get(name: string): Prepared?
	local p = prepared[name]
	if p then
		return p
	end
	local data = Clips[name]
	if not data then
		return nil
	end
	p = prepare(data)
	prepared[name] = p
	return p
end

-- Register a clip table at runtime (e.g. your own clips authored in the same format).
function ClipLibrary.register(data)
	prepared[data.name] = prepare(data)
	return prepared[data.name]
end

local function ev(ch, t)
	return if ch then evalCurve(ch, t) else 0
end

-- Samples every joint the clip owns into `out` (joint -> CFrame).
function ClipLibrary.sample(clip: Prepared, time: number, out: { [string]: CFrame })
	local t = Curve.localTime(clip, time)
	for _, j in ipairs(clip.joints) do
		local rx, ry, rz = ev(j.rx, t), ev(j.ry, t), ev(j.rz, t)
		local px, py, pz = ev(j.px, t), ev(j.py, t), ev(j.pz, t)
		out[j.name] = CFrame.new(px, py, pz) * CFrame.Angles(rad(rx), rad(ry), rad(rz))
	end
	return out
end

-- Position (studs) of a virtual position-only joint such as RootMotion at a time.
function ClipLibrary.samplePosition(clip: Prepared, jointName: string, time: number): Vector3?
	local tr = clip.data.tracks[jointName]
	if not tr then
		return nil
	end
	local t = math.clamp(time, 0, clip.length)
	return Vector3.new(ev(tr.px, t), ev(tr.py, t), ev(tr.pz, t))
end

return ClipLibrary
