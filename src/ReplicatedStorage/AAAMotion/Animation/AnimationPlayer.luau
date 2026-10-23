--[[
	Layered clip player (mirror of tools/anim/core/animator.mjs).

	Per joint, layers are applied in ascending order. Inside a layer, normal tracks that own the
	joint are averaged by weight (incremental slerp via CFrame:Lerp); the layer then overrides
	what is below it by min(totalWeight, 1). Additive tracks multiply on afterwards:
	result = result * Identity:Lerp(additive, weight).
]]

local ClipLibrary = require(script.Parent.ClipLibrary)

local IDENTITY = CFrame.identity

local Track = {}
Track.__index = Track

function Track:fadeTo(target: number, time: number)
	self.targetWeight = target
	if time > 0 then
		self.fadeRate = math.abs(target - self.weight) / time
	else
		self.fadeRate = math.huge
	end
end

function Track:stop(fade: number?)
	if self.stopping then
		return
	end
	self.stopping = true
	local f = fade or self.fadeOut
	self:fadeTo(0, f)
	-- A cut takes effect at once (even mid-update), so the next evaluation never mixes it in.
	if f <= 0 then
		self.weight = 0
	end
end

function Track:isActive(): boolean
	return not self.stopping and not self.done
end

local AnimationPlayer = {}
AnimationPlayer.__index = AnimationPlayer

export type PlayOptions = {
	layer: number?,
	weight: number?,
	fadeIn: number?,
	fadeOut: number?,
	speed: number?,
	loop: boolean?,
	hold: boolean?,
	mask: { [string]: number }?,
	time: number?,
}

function AnimationPlayer.new(jointNames: { string })
	local self = setmetatable({}, AnimationPlayer)
	self.joints = jointNames
	self.tracks = {}
	self.seq = 0
	self.timeScale = 1
	self.listeners = {}
	self.result = {}
	return self
end

function AnimationPlayer:onMarker(fn)
	table.insert(self.listeners, fn)
end

function AnimationPlayer:play(clip, opts: PlayOptions?)
	local o = opts or {}
	local fadeIn = o.fadeIn or 0.12
	self.seq += 1
	local track = setmetatable({
		seq = self.seq,
		clip = clip,
		name = clip.name,
		layer = o.layer or 0,
		time = o.time or 0,
		prevTime = o.time or 0,
		speed = o.speed or 1,
		loop = if o.loop ~= nil then o.loop else clip.loop,
		mask = o.mask,
		hold = o.hold or false,
		fadeOut = o.fadeOut or 0.15,
		weight = if fadeIn > 0 then 0 else (o.weight or 1),
		targetWeight = o.weight or 1,
		fadeRate = math.huge,
		stopping = false,
		done = false,
		pose = {},
	}, Track)
	track:fadeTo(o.weight or 1, fadeIn)
	table.insert(self.tracks, track)
	-- Stable order (layer, then start order) keeps in-layer blending identical to the JS twin.
	table.sort(self.tracks, function(a, b)
		if a.layer ~= b.layer then
			return a.layer < b.layer
		end
		return a.seq < b.seq
	end)
	return track
end

function AnimationPlayer:stopLayer(layer: number, fade: number?)
	for _, tr in ipairs(self.tracks) do
		if tr.layer == layer then
			tr:stop(fade)
		end
	end
end

function AnimationPlayer:_fire(track, marker)
	for _, fn in ipairs(self.listeners) do
		task.spawn(fn, track, marker)
	end
end

function AnimationPlayer:update(dt: number)
	local sdt = dt * self.timeScale
	for _, tr in ipairs(self.tracks) do
		-- A playing track's first update also fires markers sitting exactly on its start time
		-- (Land, DashStart, SwingStart at 0 ...).
		local fresh = not tr.started
		tr.started = true
		tr.prevTime = tr.time
		tr.time += sdt * tr.speed
		local L = tr.clip.length
		local markers = tr.clip.markers
		local fired = false
		if tr.loop then
			if tr.time >= L or tr.time < 0 then
				local wrapped = tr.time % L
				for _, m in ipairs(markers) do
					if m.t > tr.prevTime or m.t <= wrapped then
						self:_fire(tr, m)
					end
				end
				tr.time = wrapped
				tr.prevTime = wrapped
				fired = true
			end
		elseif tr.time >= L then
			tr.time = L
			if not tr.hold and not tr.stopping then
				tr:stop(0.0001)
			end
		elseif not tr.hold and not tr.stopping and tr.speed > 0 and tr.time >= L - tr.fadeOut then
			tr:stop(math.max(L - tr.time, 0.0001) / math.max(tr.speed, 1e-3))
		end
		if not fired then
			local from = if fresh and tr.speed > 0 then tr.prevTime - 1e-9 else tr.prevTime
			for _, m in ipairs(markers) do
				if m.t > from and m.t <= tr.time then
					self:_fire(tr, m)
				end
			end
		end
	end
	local keep = {}
	for _, tr in ipairs(self.tracks) do
		if tr.weight ~= tr.targetWeight then
			local step = tr.fadeRate * dt
			if step == math.huge or math.abs(tr.targetWeight - tr.weight) <= step then
				tr.weight = tr.targetWeight
			else
				tr.weight += math.sign(tr.targetWeight - tr.weight) * step
			end
		end
		if tr.stopping and tr.weight <= 0 then
			tr.done = true
		else
			table.insert(keep, tr)
		end
	end
	self.tracks = keep
end

-- Evaluates the blended pose: returns joint -> CFrame for every joint of the rig.
function AnimationPlayer:evaluate(): { [string]: CFrame }
	local result = self.result
	local tracks = self.tracks
	for _, tr in ipairs(tracks) do
		if tr.weight > 0 then
			ClipLibrary.sample(tr.clip, tr.time, tr.pose)
		end
	end
	for _, j in ipairs(self.joints) do
		local cur = IDENTITY
		local i = 1
		local n = #tracks
		while i <= n do
			local layer = tracks[i].layer
			local k = i
			while k <= n and tracks[k].layer == layer do
				k += 1
			end
			local acc, accW = nil, 0
			for idx = i, k - 1 do
				local tr = tracks[idx]
				if tr.weight > 0 and not tr.clip.additive and tr.clip.owns[j] then
					local w = tr.weight
					if tr.mask then
						w *= tr.mask[j] or tr.mask.default or 1
					end
					if w > 0 then
						local s = tr.pose[j]
						if accW == 0 then
							acc = s
						else
							acc = acc:Lerp(s, w / (accW + w))
						end
						accW += w
					end
				end
			end
			if acc then
				cur = if accW >= 1 then acc else cur:Lerp(acc, accW)
			end
			for idx = i, k - 1 do
				local tr = tracks[idx]
				if tr.weight > 0 and tr.clip.additive and tr.clip.owns[j] then
					local w = tr.weight
					if tr.mask then
						w *= tr.mask[j] or tr.mask.default or 1
					end
					if w > 0 then
						cur = cur * IDENTITY:Lerp(tr.pose[j], math.min(w, 1))
					end
				end
			end
			i = k
		end
		result[j] = cur
	end
	return result
end

return AnimationPlayer
