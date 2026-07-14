import { describe, expect, it, vi } from "vitest";
import { retryProtocolConflict } from "@/lib/services";

describe("database protocol retry", () => {
  it("retries a transient protocol conflict and returns the next result", async () => {
    const query = vi.fn()
      .mockRejectedValueOnce({ cause: { code: "08P01" } })
      .mockResolvedValueOnce("recovered");

    await expect(retryProtocolConflict(query)).resolves.toBe("recovered");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated errors and stops after three protocol conflicts", async () => {
    const unrelated = new Error("connection refused");
    const failFast = vi.fn().mockRejectedValue(unrelated);
    await expect(retryProtocolConflict(failFast)).rejects.toBe(unrelated);
    expect(failFast).toHaveBeenCalledTimes(1);

    const protocolError = { code: "08P01" };
    const exhausted = vi.fn().mockRejectedValue(protocolError);
    await expect(retryProtocolConflict(exhausted)).rejects.toBe(protocolError);
    expect(exhausted).toHaveBeenCalledTimes(3);
  });
});
