package dev.secret.velo.mixin;

import dev.secret.velo.Velo;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayNetworkHandler;
import net.minecraft.network.packet.s2c.play.EntityVelocityUpdateS2CPacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ClientPlayNetworkHandler.class)
public class VelocityPacketMixin {
    // TAIL: velocity is applied vanilla-style first, so Grim's sim and ours agree
    @Inject(method = "onEntityVelocityUpdate", at = @At("TAIL"))
    private void velo$onVelocity(EntityVelocityUpdateS2CPacket packet, CallbackInfo ci) {
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.player != null && packet.getEntityId() == mc.player.getId()) Velo.onSelfVelocity();
    }
}
