"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { ApiError } from "@/shared/lib/api-client";
import { networkApi } from "@/features/network/network.api";
import { useCreateBranch, useUpdateBranch } from "@/features/branches/branches.hooks";
import { branchFormSchema, type BranchFormValues } from "@/features/branches/branches.schemas";
import type { Branch } from "@/features/branches/branches.types";

const DEFAULT_GPS_RADIUS_METERS = 100;
const GEOLOCATION_TIMEOUT_MS = 10000;
const ipv4Pattern =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Promisified `navigator.geolocation.getCurrentPosition`; rejects when unavailable or denied. */
function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available"));
      return;
    }

    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error("Geolocation timed out"));
    }, GEOLOCATION_TIMEOUT_MS);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(position);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      },
      { enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 0 }
    );
  });
}

function normalizeIpv4(value: string) {
  const normalized = value.replace("::ffff:", "").trim();
  return ipv4Pattern.test(normalized) ? normalized : null;
}

type BranchFormProps = {
  /** When provided, the form edits this branch; otherwise it creates a new one. */
  branch?: Branch;
  onSuccess?: (branch: Branch) => void;
};

function toDefaults(branch?: Branch): BranchFormValues {
  return {
    name: branch?.name ?? "",
    address: branch?.address ?? "",
    gpsLatitude: branch ? Number(branch.gpsLatitude) : ("" as unknown as number),
    gpsLongitude: branch ? Number(branch.gpsLongitude) : ("" as unknown as number),
    gpsRadiusMeters: branch?.gpsRadiusMeters ?? ("" as unknown as number),
    allowedIpCidr: branch?.allowedIpCidr ?? ""
  };
}

/** Create/edit form for a branch. Reused on the new- and edit-branch screens. */
export function BranchForm({ branch, onSuccess }: BranchFormProps) {
  const createBranch = useCreateBranch();
  const updateBranch = useUpdateBranch();
  const isPending = createBranch.isPending || updateBranch.isPending;

  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [isDetectingIp, setIsDetectingIp] = useState(false);

  const form = useForm<BranchFormValues>({
    // `z.coerce` makes the schema's input/output types differ; cast the
    // resolver to the output type so RHF's generics line up.
    resolver: zodResolver(branchFormSchema) as Resolver<BranchFormValues>,
    defaultValues: toDefaults(branch)
  });

  async function handleDetectLocation() {
    setIsDetectingLocation(true);
    try {
      const position = await getCurrentPosition();
      form.setValue("gpsLatitude", position.coords.latitude, { shouldValidate: true });
      form.setValue("gpsLongitude", position.coords.longitude, { shouldValidate: true });
      if (!form.getValues("gpsRadiusMeters")) {
        form.setValue("gpsRadiusMeters", DEFAULT_GPS_RADIUS_METERS, { shouldValidate: true });
      }
      toast.success("تم الكشف عن الموقع تلقائيًا");
    } catch {
      toast.error("تعذّر الكشف عن الموقع، أدخله يدويًا");
    } finally {
      setIsDetectingLocation(false);
    }
  }

  async function handleDetectIp() {
    setIsDetectingIp(true);
    try {
      const { ip } = await networkApi.whoami();
      const normalizedIp = normalizeIpv4(ip);

      if (!normalizedIp) {
        toast.error("تعذّر الكشف عن IPv4 صالح، أدخل نطاق الـ IP يدويًا");
        return;
      }

      form.setValue("allowedIpCidr", `${normalizedIp}/32`, { shouldValidate: true });
      toast.success("تم الكشف عن الـ IP تلقائيًا");
    } catch {
      toast.error("تعذّر الكشف عن الـ IP، أدخله يدويًا");
    } finally {
      setIsDetectingIp(false);
    }
  }

  function onSubmit(values: BranchFormValues) {
    const onError = (error: unknown) => {
      const message =
        error instanceof ApiError ? error.message : "تعذّر حفظ الفرع، حاول مرة أخرى";
      toast.error(message);
    };

    if (branch) {
      updateBranch.mutate(
        { branchId: branch.id, input: values },
        { onSuccess: ({ branch: updated }) => onSuccess?.(updated), onError }
      );
      return;
    }

    createBranch.mutate(values, {
      onSuccess: ({ branch: created }) => onSuccess?.(created),
      onError
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>اسم الفرع</FormLabel>
              <FormControl>
                <Input placeholder="فرع المعادي" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>العنوان</FormLabel>
              <FormControl>
                <Textarea rows={2} placeholder="العنوان التفصيلي للفرع" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleDetectLocation}
            disabled={isDetectingLocation}
          >
            {isDetectingLocation ? "جارٍ كشف الموقع..." : "كشف الموقع"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleDetectIp}
            disabled={isDetectingIp}
          >
            {isDetectingIp ? "جارٍ كشف الـ IP..." : "كشف الـ IP"}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="gpsLatitude"
            render={({ field }) => (
              <FormItem>
                <FormLabel>خط العرض</FormLabel>
                <FormControl>
                  <Input type="number" step="any" dir="ltr" placeholder="29.9602" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="gpsLongitude"
            render={({ field }) => (
              <FormItem>
                <FormLabel>خط الطول</FormLabel>
                <FormControl>
                  <Input type="number" step="any" dir="ltr" placeholder="31.2569" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="gpsRadiusMeters"
            render={({ field }) => (
              <FormItem>
                <FormLabel>نطاق الموقع (متر)</FormLabel>
                <FormControl>
                  <Input type="number" dir="ltr" placeholder="100" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="allowedIpCidr"
            render={({ field }) => (
              <FormItem>
                <FormLabel>نطاق الـ IP المسموح</FormLabel>
                <FormControl>
                  <Input dir="ltr" placeholder="196.221.0.0/16" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Button type="submit" disabled={isPending}>
          {isPending ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
      </form>
    </Form>
  );
}
