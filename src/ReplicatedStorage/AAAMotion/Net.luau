--[[
	Remote plumbing. The server creates the remotes; clients wait for them.

	C2S (client -> server):  kind, ...
		"Play"      clipName, opts                 replicate a movement/emote clip
		"Stop"      fade                            stop the replicated action
		"State"     { armed?, crouch?, blocking? }  replicated flags
		"Attack"    attackName                      starts an attack (server records timing)
		"HitClaim"  attackName, finisher, victims   client-detected hits, validated by the server
		"Charge"                                    heavy charge started
		"Slam"                                      aerial slam started
		"Effect"    effectName, cframe              cosmetic effect for others (dash burst ...)

	S2C (server -> clients):  kind, ...
		"Play"      model, clipName, opts, serverTime
		"Stop"      model, fade
		"Hit"       { attacker, victim, result, point, dir, effect, ... }
		"Knock"     { velocity, launch }            sent to the victim's owner only
		"Effect"    model, effectName, cframe
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local FOLDER = "AAAMotionNet"

local Net = {}

local folder: Folder? = nil

local function getFolder(): Folder
	if folder then
		return folder
	end
	local f: Folder
	if RunService:IsServer() then
		local existing = ReplicatedStorage:FindFirstChild(FOLDER)
		if existing and existing:IsA("Folder") then
			f = existing
		else
			f = Instance.new("Folder")
			f.Name = FOLDER
			for _, name in ipairs({ "C2S", "S2C" }) do
				local r = Instance.new("RemoteEvent")
				r.Name = name
				r.Parent = f
			end
			f.Parent = ReplicatedStorage
		end
	else
		f = ReplicatedStorage:WaitForChild(FOLDER) :: Folder
	end
	folder = f
	return f
end

function Net.remote(name: string): RemoteEvent
	return getFolder():WaitForChild(name) :: RemoteEvent
end

-- Client: send to server.
function Net.send(kind: string, ...)
	Net.remote("C2S"):FireServer(kind, ...)
end

-- Server: broadcast to every client, optionally skipping one player.
function Net.broadcast(except: Player?, kind: string, ...)
	local r = Net.remote("S2C")
	if except == nil then
		r:FireAllClients(kind, ...)
		return
	end
	for _, p in ipairs(game:GetService("Players"):GetPlayers()) do
		if p ~= except then
			r:FireClient(p, kind, ...)
		end
	end
end

function Net.sendTo(player: Player, kind: string, ...)
	Net.remote("S2C"):FireClient(player, kind, ...)
end

return Net
