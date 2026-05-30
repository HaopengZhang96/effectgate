package dev.effectgate;

import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.security.ProtectionDomain;

public final class EffectGateAgent {
    private EffectGateAgent() {}

    public static void premain(String agentArgs, Instrumentation instrumentation) {
        instrumentation.addTransformer(new ClassNameTripwireTransformer());
    }

    static final class ClassNameTripwireTransformer implements ClassFileTransformer {
        @Override
        public byte[] transform(
                ClassLoader loader,
                String className,
                Class<?> classBeingRedefined,
                ProtectionDomain protectionDomain,
                byte[] classfileBuffer
        ) {
            if (className == null || className.startsWith("java/") || className.startsWith("jdk/")) {
                return null;
            }
            String dotted = className.replace('/', '.');
            try {
                EffectGate.check(dotted, "[]");
            } catch (EffectGateBlocked blocked) {
                throw blocked;
            }
            return null;
        }
    }
}
