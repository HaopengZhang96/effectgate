package dev.effectgate;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;

public final class EffectGate {
    private EffectGate() {}

    public static void check(String effectId, String argsJson) {
        List<String> command = new ArrayList<>();
        command.add(effectgateBin());
        command.add("check");
        command.add(effectId);
        command.add("--args-json");
        command.add(argsJson == null ? "[]" : argsJson);
        ProcessBuilder builder = new ProcessBuilder(command);
        try {
            Process process = builder.start();
            String stderr = read(process.getErrorStream());
            String stdout = read(process.getInputStream());
            int status = process.waitFor();
            if (status != 0) {
                throw new EffectGateBlocked(stderr.isBlank() ? stdout : stderr, status);
            }
        } catch (IOException e) {
            throw new EffectGateBlocked(e.getMessage(), 1);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new EffectGateBlocked("EffectGate check interrupted", 1);
        }
    }

    private static String effectgateBin() {
        String fromEnv = System.getenv("EFFECTGATE_BIN");
        return fromEnv == null || fromEnv.isBlank() ? "effectgate" : fromEnv;
    }

    private static String read(java.io.InputStream stream) throws IOException {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream))) {
            StringBuilder builder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line).append(System.lineSeparator());
            }
            return builder.toString();
        }
    }
}
