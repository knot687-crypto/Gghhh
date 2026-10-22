--[[
	Easing functions indexed by the integer codes stored in compiled clips.
	Mirrors tools/anim/core/easing.mjs exactly (order must never change).
	0 = smooth (Hermite, handled by Curve), 1 = linear, 2 = constant.
]]

local Easing = {}

local PI = math.pi
local C1 = 1.70158
local C2 = C1 * 1.525
local C3 = C1 + 1
local C4 = (2 * PI) / 3

local function outBounce(t: number): number
	local n1, d1 = 7.5625, 2.75
	if t < 1 / d1 then
		return n1 * t * t
	elseif t < 2 / d1 then
		t -= 1.5 / d1
		return n1 * t * t + 0.75
	elseif t < 2.5 / d1 then
		t -= 2.25 / d1
		return n1 * t * t + 0.9375
	end
	t -= 2.625 / d1
	return n1 * t * t + 0.984375
end

local fns: { [number]: (number) -> number } = {
	[0] = function(t)
		return t
	end,
	[1] = function(t)
		return t
	end,
	[2] = function()
		return 0
	end,
	[3] = function(t)
		return t * t
	end,
	[4] = function(t)
		return 1 - (1 - t) * (1 - t)
	end,
	[5] = function(t)
		return if t < 0.5 then 2 * t * t else 1 - (-2 * t + 2) ^ 2 / 2
	end,
	[6] = function(t)
		return t * t * t
	end,
	[7] = function(t)
		return 1 - (1 - t) ^ 3
	end,
	[8] = function(t)
		return if t < 0.5 then 4 * t * t * t else 1 - (-2 * t + 2) ^ 3 / 2
	end,
	[9] = function(t)
		return t * t * t * t
	end,
	[10] = function(t)
		return 1 - (1 - t) ^ 4
	end,
	[11] = function(t)
		return if t < 0.5 then 8 * t * t * t * t else 1 - (-2 * t + 2) ^ 4 / 2
	end,
	[12] = function(t)
		return t * t * t * t * t
	end,
	[13] = function(t)
		return 1 - (1 - t) ^ 5
	end,
	[14] = function(t)
		return if t < 0.5 then 16 * t * t * t * t * t else 1 - (-2 * t + 2) ^ 5 / 2
	end,
	[15] = function(t)
		return 1 - math.cos((t * PI) / 2)
	end,
	[16] = function(t)
		return math.sin((t * PI) / 2)
	end,
	[17] = function(t)
		return -(math.cos(PI * t) - 1) / 2
	end,
	[18] = function(t)
		return if t == 0 then 0 else 2 ^ (10 * t - 10)
	end,
	[19] = function(t)
		return if t == 1 then 1 else 1 - 2 ^ (-10 * t)
	end,
	[20] = function(t)
		if t == 0 then
			return 0
		elseif t == 1 then
			return 1
		elseif t < 0.5 then
			return 2 ^ (20 * t - 10) / 2
		end
		return (2 - 2 ^ (-20 * t + 10)) / 2
	end,
	[21] = function(t)
		return 1 - math.sqrt(1 - t * t)
	end,
	[22] = function(t)
		return math.sqrt(1 - (t - 1) * (t - 1))
	end,
	[23] = function(t)
		return if t < 0.5 then (1 - math.sqrt(1 - 4 * t * t)) / 2 else (math.sqrt(1 - (-2 * t + 2) ^ 2) + 1) / 2
	end,
	[24] = function(t)
		return C3 * t * t * t - C1 * t * t
	end,
	[25] = function(t)
		return 1 + C3 * (t - 1) ^ 3 + C1 * (t - 1) ^ 2
	end,
	[26] = function(t)
		if t < 0.5 then
			return ((2 * t) ^ 2 * ((C2 + 1) * 2 * t - C2)) / 2
		end
		return ((2 * t - 2) ^ 2 * ((C2 + 1) * (t * 2 - 2) + C2) + 2) / 2
	end,
	[27] = function(t)
		if t == 0 then
			return 0
		elseif t == 1 then
			return 1
		end
		return 2 ^ (-10 * t) * math.sin((t * 10 - 0.75) * C4) + 1
	end,
	[28] = outBounce,
}

Easing.byCode = fns

function Easing.apply(code: number, t: number): number
	local f = fns[code]
	return if f then f(t) else t
end

return Easing
