import { Suspense } from "react";
import ResetPasswordForm from "./reset-password-form";

export const metadata = {
  title: "Reset Password",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white px-4 py-8">
      <Suspense fallback={<div className="text-zinc-500">Loading...</div>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}