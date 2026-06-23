import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/shared/components/ui/card";
import { AdminSignInForm } from "@/features/auth/components/admin-sign-in-form";
import { RedirectAuthenticatedFromSignIn } from "@/features/auth/components/redirect-authenticated-from-sign-in";

export default function AdminSignInPage() {
  return (
    <RedirectAuthenticatedFromSignIn>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">تسجيل دخول المسؤول</CardTitle>
          <CardDescription>أدخل بريدك الإلكتروني وكلمة المرور للمتابعة</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminSignInForm />
        </CardContent>
      </Card>
    </RedirectAuthenticatedFromSignIn>
  );
}
