"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
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
import { ApiError } from "@/shared/lib/api-client";
import { useAdminSignIn } from "@/features/auth/auth.hooks";
import {
  adminSignInFormSchema,
  type AdminSignInFormValues
} from "@/features/auth/auth.schemas";

/** Admin sign-in (email + password). On success routes to the admin dashboard. */
export function AdminSignInForm() {
  const router = useRouter();
  const signIn = useAdminSignIn();

  const form = useForm<AdminSignInFormValues>({
    resolver: zodResolver(adminSignInFormSchema),
    defaultValues: { email: "", password: "" }
  });

  function onSubmit(values: AdminSignInFormValues) {
    signIn.mutate(values, {
      onSuccess: () => router.replace("/dashboard"),
      onError: (error) => {
        const message =
          error instanceof ApiError ? error.message : "تعذّر تسجيل الدخول، حاول مرة أخرى";
        toast.error(message);
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>البريد الإلكتروني</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  dir="ltr"
                  autoComplete="username"
                  placeholder="admin.test@capella.invalid"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>كلمة المرور</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={signIn.isPending}>
          {signIn.isPending ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول"}
        </Button>
      </form>
    </Form>
  );
}
