import { EmployeeDeviceSetupForm } from "@/features/employees/components/employee-device-setup-form";

export default async function EmployeeDeviceSetupPage({
  params
}: {
  params: Promise<{ deviceToken: string }>;
}) {
  const { deviceToken } = await params;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl items-center p-4 sm:p-6">
      <EmployeeDeviceSetupForm deviceToken={deviceToken} />
    </main>
  );
}
