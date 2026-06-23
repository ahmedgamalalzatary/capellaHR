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
import { useSignIn } from "@/features/auth/auth.hooks";
import {
  employeeSignInFormSchema,
  type EmployeeSignInFormValues
} from "@/features/auth/auth.schemas";

/** Employee sign-in (phone + password). On success routes to the employee home. */
export function SignInForm() {
  const router = useRouter();
  const signIn = useSignIn();

  const form = useForm<EmployeeSignInFormValues>({
    resolver: zodResolver(employeeSignInFormSchema),
    defaultValues: { phone: "", password: "" }
  });

  function onSubmit(values: EmployeeSignInFormValues) {
    signIn.mutate(values, {
      onSuccess: () => router.replace("/attendance"),
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
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>رقم الهاتف</FormLabel>
              <FormControl>
                <Input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="username"
                  placeholder="01XXXXXXXXX"
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
