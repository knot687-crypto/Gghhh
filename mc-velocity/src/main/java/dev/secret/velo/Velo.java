package dev.secret.velo;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.network.packet.c2s.play.ClientCommandC2SPacket;
import net.minecraft.text.Text;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.EntityHitResult;
import net.minecraft.util.hit.HitResult;
import org.lwjgl.glfw.GLFW;

/**
 * Grim-safe velocity: no packet cancelling, no transaction games. Only uses
 * mechanics Grim's prediction engine already simulates:
 *  - ATTACK_REDUCE: sprint-attacks multiply own motion by 0.6 each hit
 *  - JUMP_RESET:    jumping on the knockback tick eats part of the horizontal
 */
public final class Velo implements ClientModInitializer {
    // ---- config ----
    public enum Mode { ATTACK_REDUCE, JUMP_RESET, BOTH }
    static Mode kMode = Mode.BOTH;
    static final int kToggleKey  = GLFW.GLFW_KEY_V;
    static final int kModeKey    = GLFW.GLFW_KEY_B;
    static final int kAttackHits = 5;      // 0.6^5 ≈ 0.08 horizontal left. drop to 2-3 if Grim flags
    static final double kReach   = 3.0;    // stay under Grim's reach check
    static final boolean kNeedSprint = true;

    static boolean enabled = false;        // off on launch
    static volatile boolean pending = false;
    static KeyBinding toggle, mode;

    public static void onSelfVelocity() { if (enabled) pending = true; }

    @Override public void onInitializeClient() {
        KeyBinding.Category cat = KeyBinding.Category.create(net.minecraft.util.Identifier.of("velo", "main"));
        toggle = KeyBindingHelper.registerKeyBinding(new KeyBinding("key.velo.toggle", kToggleKey, cat));
        mode   = KeyBindingHelper.registerKeyBinding(new KeyBinding("key.velo.mode",   kModeKey,   cat));
        ClientTickEvents.END_CLIENT_TICK.register(Velo::tick);
    }

    private static void tick(MinecraftClient mc) {
        ClientPlayerEntity p = mc.player;
        if (p == null) return;
        while (toggle.wasPressed()) { enabled = !enabled; say(p, "velo " + (enabled ? "§aON" : "§cOFF") + " §7" + kMode); }
        while (mode.wasPressed())   { kMode = Mode.values()[(kMode.ordinal() + 1) % Mode.values().length]; say(p, "mode §e" + kMode); }
        if (!pending) return;
        pending = false;

        if (kMode != Mode.JUMP_RESET) attackReduce(mc, p);
        if (kMode != Mode.ATTACK_REDUCE && p.isOnGround()) p.jump();
    }

    private static void attackReduce(MinecraftClient mc, ClientPlayerEntity p) {
        Entity target = pickTarget(mc, p);
        if (target == null || mc.interactionManager == null) return;
        if (kNeedSprint && !p.isSprinting()) return;
        for (int i = 0; i < kAttackHits; i++) {
            // vanilla attack() drops sprint after the hit; re-assert it so the next hit also gets the 0.6
            if (i > 0) {
                p.networkHandler.sendPacket(new ClientCommandC2SPacket(p, ClientCommandC2SPacket.Mode.START_SPRINTING));
                p.setSprinting(true);
            }
            mc.interactionManager.attackEntity(p, target);
            p.swingHand(Hand.MAIN_HAND);
        }
    }

    private static Entity pickTarget(MinecraftClient mc, ClientPlayerEntity p) {
        if (mc.crosshairTarget != null && mc.crosshairTarget.getType() == HitResult.Type.ENTITY) {
            Entity e = ((EntityHitResult) mc.crosshairTarget).getEntity();
            if (e instanceof LivingEntity && p.distanceTo(e) <= kReach) return e;
        }
        // fallback: whoever hit us, if they're in reach (Grim checks hitbox via look, so this one may flag more)
        LivingEntity atk = p.getAttacker();
        return atk != null && p.distanceTo(atk) <= kReach ? atk : null;
    }

    private static void say(ClientPlayerEntity p, String s) { p.sendMessage(Text.literal("§8[§bvelo§8] §f" + s), true); }
}
