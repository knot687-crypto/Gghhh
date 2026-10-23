--[[
	User-facing settings. Everything gameplay-numeric (speeds, attack data, VFX recipes) lives in
	Generated/Tuning and Generated/VFXRecipes, exported from tools/anim so the preview videos and
	the game always agree.

	Textures: upload the PNGs in assets/textures (Asset Manager > Bulk Import) and paste the ids
	here (e.g. "rbxassetid://123"). Empty entries fall back to Roblox's built-in particle textures.
]]

return {
	Textures = {
		spark = "",
		glow = "",
		streak = "",
		smoke = "",
		ring = "",
		crack = "",
	},
	FallbackTextures = {
		spark = "rbxasset://textures/particles/sparkles_main.dds",
		glow = "rbxasset://textures/particles/sparkles_main.dds",
		streak = "rbxasset://textures/particles/sparkles_main.dds",
		smoke = "rbxasset://textures/particles/smoke_main.dds",
		ring = "rbxasset://textures/particles/explosion01_shockwave_main.dds",
		crack = "",
	},

	-- Tag a Model (R15 rig with a Humanoid) with this to have every client animate it.
	CharacterTag = "AAACharacter",

	Keys = {
		Sprint = { Enum.KeyCode.LeftShift, Enum.KeyCode.ButtonL3 },
		Crouch = { Enum.KeyCode.LeftControl, Enum.KeyCode.C, Enum.KeyCode.ButtonB },
		Dash = { Enum.KeyCode.Q, Enum.KeyCode.ButtonR1 },
		Light = { Enum.UserInputType.MouseButton1, Enum.KeyCode.ButtonX },
		Heavy = { Enum.UserInputType.MouseButton2, Enum.KeyCode.ButtonY },
		Block = { Enum.KeyCode.F, Enum.KeyCode.ButtonL1 },
		Lunge = { Enum.KeyCode.R, Enum.KeyCode.ButtonR2 },
		Draw = { Enum.KeyCode.E, Enum.KeyCode.DPadLeft },
		ToggleView = { Enum.KeyCode.V, Enum.KeyCode.DPadUp },
	},

	Camera = {
		distance = 12,
		minDistance = 6,
		maxDistance = 22,
		shoulder = Vector3.new(1.9, 1.7, 0),
		pitchMin = -70,
		pitchMax = 65,
		mouseSensitivity = 0.0032,
		gamepadSensitivity = 3.2,
		followRate = 18,
		firstPersonEye = 1.5,
		startFirstPerson = false,
	},

	Graphics = {
		-- "Wedge" builds slash ribbons from triangles along the baked swing path (smooth at any
		-- frame rate). "Trail" uses Roblox Trails on the blade (cheaper, coarser on fast swings).
		ribbonMode = "Wedge",
		ribbonSegments = 20,
		afterimages = true,
		maxAfterimageParts = 260,
		lights = true,
		screenEffects = true,
		speedLines = true,
		-- Characters further than this (studs) from the camera get simplified updates.
		lodDistance = 160,
	},

	-- Simulated headband + obi sash tails (secondary motion) on player characters and the rival.
	-- Per character, the AAA_ClothSash / AAA_ClothBand (Color3) attributes override the colors and
	-- AAA_NoCloth = true turns it off.
	Cloth = {
		enabled = true,
		sash = "#a3242c",
		band = "#b8262f",
	},

	Combat = {
		comboBuffer = 0.35,
		lungeCooldown = 1.1,
		maxHealth = 150,
		respawnDummies = true,
	},

	Debug = {
		drawHitboxes = false,
	},
}
