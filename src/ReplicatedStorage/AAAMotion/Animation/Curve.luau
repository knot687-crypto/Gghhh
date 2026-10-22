--[[
	Curve evaluation for compiled clip channels (mirror of evalChannel in
	tools/anim/core/curve.mjs). A channel is { t = {...}, v = {...}, m = {...}, e = {...}? }:
	key times, values, baked tangents (units/s) and the ease code leaving each key
	(missing `e` = all smooth). Arrays are 1-based here.
]]

local Easing = require(script.Parent.Easing)

local ease = Easing.byCode

local Curve = {}

function Curve.eval(ch, time: number): number
	local t = ch.t
	local n = #t
	local v = ch.v
	if n == 1 or time <= t[1] then
		return v[1]
	end
	if time >= t[n] then
		return v[n]
	end
	local lo, hi = 1, n
	while hi - lo > 1 do
		local mid = (lo + hi) // 2
		if t[mid] <= time then
			lo = mid
		else
			hi = mid
		end
	end
	local i = lo
	local h = t[i + 1] - t[i]
	local u = (time - t[i]) / h
	local v0, v1 = v[i], v[i + 1]
	local e = if ch.e then ch.e[i] else 0
	if e == 0 then
		local m = ch.m
		local u2 = u * u
		local u3 = u2 * u
		return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * h * m[i + 1]
	elseif e == 1 then
		return v0 + (v1 - v0) * u
	elseif e == 2 then
		return v0
	end
	return v0 + (v1 - v0) * ease[e](u)
end

-- Wraps (looping) or clamps a playback time into the clip's range.
function Curve.localTime(clip, time: number): number
	local L = clip.length
	if clip.loop then
		return time % L
	end
	return math.clamp(time, 0, L)
end

return Curve
