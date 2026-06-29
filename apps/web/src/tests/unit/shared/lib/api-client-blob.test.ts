import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { ApiError, api } from "@/shared/lib/api-client";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

describe("api.getBlob", () => {
  it("returns the response body as a Blob with its content type", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    server.use(
      http.get(apiUrl("/employees/1/files/2"), () =>
        HttpResponse.arrayBuffer(bytes.buffer, { headers: { "Content-Type": "image/png" } })
      )
    );

    const blob = await api.getBlob("/employees/1/files/2");

    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(4);
  });

  it("throws ApiError on a non-2xx response", async () => {
    server.use(
      http.get(apiUrl("/employees/1/files/999"), () =>
        HttpResponse.json(
          { error: { code: "EMPLOYEE_FILE_NOT_FOUND", message: "not found" } },
          { status: 404 }
        )
      )
    );

    await expect(api.getBlob("/employees/1/files/999")).rejects.toMatchObject({
      name: "ApiError",
      status: 404
    } satisfies Partial<ApiError>);
  });

  it("ignores GET-unsafe request options", async () => {
    let method: string | null = null;
    let body = "";
    let downloadQuery: string | null = null;
    const unsafeOptions = {
      method: "POST",
      body: "x",
      query: { download: true }
    } as unknown as Parameters<typeof api.getBlob>[1];
    server.use(
      http.get(apiUrl("/employees/1/files/7"), async ({ request }) => {
        method = request.method;
        downloadQuery = new URL(request.url).searchParams.get("download");
        body = await request.text();
        return HttpResponse.arrayBuffer(new Uint8Array([7]).buffer, {
          headers: { "Content-Type": "image/png" }
        });
      })
    );

    const blob = await api.getBlob("/employees/1/files/7", unsafeOptions);

    expect(blob.size).toBe(1);
    expect(method).toBe("GET");
    expect(body).toBe("");
    expect(downloadQuery).toBe("true");
  });
});
