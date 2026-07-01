import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import AdminMonthLocksPage from "@/app/(admin)/admin/month-locks/page";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/month-locks",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

function monthLocksResponse(page = 1) {
  return {
    monthLocks: {
      items: [
        {
          id: 7,
          monthKey: page === 1 ? "2026-05" : "2026-04",
          lockedAt: "2026-06-01T10:15:00.000Z",
          lockedByAdminId: 3,
          notes: "إغلاق الرواتب"
        }
      ],
      pagination: {
        page,
        pageSize: 10,
        total: 11,
        totalPages: 2
      }
    }
  };
}

describe("AdminMonthLocksPage", () => {
  it("lists existing month locks and explains operational impact", async () => {
    server.use(
      http.get(apiUrl("/month-locks"), ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("monthKey")).toBeNull();
        expect(url.searchParams.get("page")).toBe("1");
        expect(url.searchParams.get("pageSize")).toBe("10");

        return HttpResponse.json(monthLocksResponse());
      })
    );

    renderWithProviders(<AdminMonthLocksPage />);

    expect(await screen.findByRole("heading", { name: "أقفال الشهور" })).toBeInTheDocument();
    expect(await screen.findByText("2026-05")).toBeInTheDocument();
    expect(screen.getByText("مدير #3")).toBeInTheDocument();
    expect(screen.getByText("إغلاق الرواتب")).toBeInTheDocument();
    expect(screen.getByText("الصفحة 1 من 2")).toBeInTheDocument();
    expect(screen.getByText(/يمنع تعديل الحضور/)).toBeInTheDocument();
  });

  it("filters by month, paginates, and creates a month lock with notes", async () => {
    const seenQueries: string[] = [];
    const createdPayloads: unknown[] = [];

    server.use(
      http.get(apiUrl("/month-locks"), ({ request }) => {
        const url = new URL(request.url);
        seenQueries.push(url.search);

        return HttpResponse.json(monthLocksResponse(Number(url.searchParams.get("page") ?? 1)));
      }),
      http.post(apiUrl("/month-locks"), async ({ request }) => {
        createdPayloads.push(await request.json());

        return HttpResponse.json(
          {
            monthLock: {
              id: 8,
              monthKey: "2026-04",
              lockedAt: "2026-05-01T10:15:00.000Z",
              lockedByAdminId: 3,
              notes: "تمت المراجعة"
            }
          },
          { status: 201 }
        );
      })
    );

    renderWithProviders(<AdminMonthLocksPage />);

    await screen.findByText("2026-05");
    await userEvent.setup().type(screen.getByLabelText("فلترة بالشهر"), "2026-05");
    await userEvent.setup().click(screen.getByRole("button", { name: "تطبيق الفلتر" }));

    await waitFor(() => expect(seenQueries.at(-1)).toContain("monthKey=2026-05"));
    expect(seenQueries.at(-1)).toContain("page=1");
    expect(seenQueries.at(-1)).toContain("pageSize=10");

    await userEvent.setup().click(screen.getByRole("button", { name: "الصفحة التالية" }));

    await waitFor(() => expect(seenQueries.at(-1)).toContain("page=2"));
    expect(seenQueries.at(-1)).toContain("monthKey=2026-05");
    expect(await screen.findByText("2026-04")).toBeInTheDocument();

    await userEvent.setup().type(screen.getByLabelText("الشهر المراد قفله"), "2026-04");
    await userEvent.setup().type(screen.getByLabelText("ملاحظات القفل"), "تمت المراجعة");
    await userEvent.setup().click(screen.getByRole("button", { name: "قفل الشهر" }));

    await waitFor(() =>
      expect(createdPayloads).toContainEqual({
        monthKey: "2026-04",
        notes: "تمت المراجعة"
      })
    );
    expect(screen.getByText("تم قفل الشهر بنجاح.")).toBeInTheDocument();
  });

  it("maps month lock create errors by stable error code", async () => {
    server.use(
      http.get(apiUrl("/month-locks"), () => HttpResponse.json(monthLocksResponse())),
      http.post(apiUrl("/month-locks"), () =>
        HttpResponse.json(
          {
            error: {
              code: "MONTH_LOCK_ALREADY_EXISTS",
              message: "Backend wording can change",
              details: {}
            }
          },
          { status: 409 }
        )
      )
    );

    renderWithProviders(<AdminMonthLocksPage />);

    await screen.findByText("2026-05");
    await userEvent.setup().type(screen.getByLabelText("الشهر المراد قفله"), "2026-04");
    await userEvent.setup().click(screen.getByRole("button", { name: "قفل الشهر" }));

    expect(await screen.findByText("هذا الشهر مقفل بالفعل.")).toBeInTheDocument();
  });
});
