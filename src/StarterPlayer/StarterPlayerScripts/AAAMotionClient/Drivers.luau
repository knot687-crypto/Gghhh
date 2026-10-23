--[[
	Registry of CharacterDrivers: one per AAA character (tagged with Config.CharacterTag by the
	server: player characters and NPCs). Handles streaming in/out and respawns.
]]

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")

local AAAMotion = game:GetService("ReplicatedStorage"):WaitForChild("AAAMotion")
local Config = require(AAAMotion.Config)
local CharacterDriver = require(script.Parent.CharacterDriver)

local Drivers = {}

local byModel: { [Model]: any } = {}
local pending: { [Model]: boolean } = {}
local added = Instance.new("BindableEvent")
Drivers.added = added.Event

local REQUIRED = { "HumanoidRootPart", "LowerTorso", "UpperTorso", "Head", "LeftFoot", "RightHand" }

local function ready(model: Model): boolean
	if not model:FindFirstChildOfClass("Humanoid") then
		return false
	end
	for _, n in ipairs(REQUIRED) do
		if not model:FindFirstChild(n) then
			return false
		end
	end
	local lt = model:FindFirstChild("LowerTorso")
	return lt ~= nil and lt:FindFirstChild("Root") ~= nil
end

local function track(model: Instance)
	if not model:IsA("Model") or byModel[model] or pending[model] then
		return
	end
	pending[model] = true
	task.spawn(function()
		local t0 = os.clock()
		while model.Parent and not ready(model) and os.clock() - t0 < 15 do
			task.wait(0.1)
		end
		pending[model] = nil
		if not model.Parent or not ready(model) or byModel[model] then
			return
		end
		local isLocal = model == Players.LocalPlayer.Character
		local driver = CharacterDriver.new(model, isLocal)
		byModel[model] = driver
		added:Fire(driver)
		local conn
		conn = model.AncestryChanged:Connect(function(_, parent)
			if parent == nil then
				conn:Disconnect()
				Drivers.remove(model)
			end
		end)
	end)
end

function Drivers.remove(model: Model)
	local d = byModel[model]
	if d then
		byModel[model] = nil
		d:destroy()
	end
end

function Drivers.start()
	for _, m in ipairs(CollectionService:GetTagged(Config.CharacterTag)) do
		track(m)
	end
	CollectionService:GetInstanceAddedSignal(Config.CharacterTag):Connect(track)
	CollectionService:GetInstanceRemovedSignal(Config.CharacterTag):Connect(function(m)
		if m:IsA("Model") then
			Drivers.remove(m)
		end
	end)
end

function Drivers.get(model: Instance?): any
	if model == nil then
		return nil
	end
	return byModel[model :: Model]
end

function Drivers.all()
	return byModel
end

-- Living characters other than `except`, as hit-query candidates.
function Drivers.candidates(except: Model?): { { model: Model, root: BasePart } }
	local out = {}
	for model, d in pairs(byModel) do
		if model ~= except and d.root.Parent and d.humanoid.Health > 0 then
			table.insert(out, { model = model, root = d.root })
		end
	end
	return out
end

function Drivers.update(dt: number, timeScale: number)
	for _, d in pairs(byModel) do
		d:update(dt, timeScale)
	end
end

function Drivers.postUpdate(dt: number, timeScale: number)
	for _, d in pairs(byModel) do
		d:postUpdate(dt, timeScale)
	end
end

return Drivers
