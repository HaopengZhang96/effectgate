package dev.effectgate;

public final class EffectGateBlocked extends RuntimeException {
    private final int status;

    public EffectGateBlocked(String message, int status) {
        super(message);
        this.status = status;
    }

    public int status() {
        return status;
    }
}
