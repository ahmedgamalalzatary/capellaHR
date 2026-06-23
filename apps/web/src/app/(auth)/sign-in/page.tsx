import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/shared/components/ui/card";
import { RedirectAuthenticatedFromSignIn } from "@/features/auth/components/redirect-authenticated-from-sign-in";
import { SignInForm } from "@/features/auth/components/sign-in-form";

export default function EmployeeSignInPage() {
  return (
    <RedirectAuthenticatedFromSignIn>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">تسجيل دخول الموظف</CardTitle>
          <CardDescription>أدخل رقم هاتفك وكلمة المرور للمتابعة</CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm />
        </CardContent>
      </Card>
    </RedirectAuthenticatedFromSignIn>
  );
}
