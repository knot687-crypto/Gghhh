--[[
	Action bindings (keyboard, mouse, gamepad, touch buttons) through ContextActionService.
	Keys live in Config.Keys. Movement and jumping stay on Roblox's default controls.
]]

local ContextActionService = game:GetService("ContextActionService")

local AAAMotion = game:GetService("ReplicatedStorage"):WaitForChild("AAAMotion")
local Config = require(AAAMotion.Config)

local Input = {}

local TOUCH = {
	Light = { title = "Slash", pos = UDim2.new(1, -95, 1, -170) },
	Heavy = { title = "Heavy", pos = UDim2.new(1, -170, 1, -120) },
	Block = { title = "Block", pos = UDim2.new(1, -180, 1, -200) },
	Dash = { title = "Dash", pos = UDim2.new(1, -95, 1, -250) },
	Crouch = { title = "Slide", pos = UDim2.new(1, -250, 1, -150) },
	Sprint = { title = "Run", pos = UDim2.new(1, -260, 1, -230) },
	Lunge = { title = "Lunge", pos = UDim2.new(1, -170, 1, -280) },
	Draw = { title = "Draw", pos = UDim2.new(1, -250, 1, -310) },
	ToggleView = { title = "View", pos = UDim2.new(1, -95, 1, -330) },
}

local held: { [string]: boolean } = {}

-- handler(action, down) is called on press and release.
function Input.bind(handler: (string, boolean) -> ())
	for action, keys in pairs(Config.Keys) do
		local touch = TOUCH[action]
		ContextActionService:BindAction("AAA_" .. action, function(_, state)
			if state == Enum.UserInputState.Begin then
				held[action] = true
				handler(action, true)
			elseif state == Enum.UserInputState.End or state == Enum.UserInputState.Cancel then
				if held[action] then
					held[action] = false
					handler(action, false)
				end
			end
			return Enum.ContextActionResult.Pass
		end, touch ~= nil, table.unpack(keys))
		if touch then
			ContextActionService:SetTitle("AAA_" .. action, touch.title)
			ContextActionService:SetPosition("AAA_" .. action, touch.pos)
		end
	end
end

function Input.held(action: string): boolean
	return held[action] == true
end

return Input
