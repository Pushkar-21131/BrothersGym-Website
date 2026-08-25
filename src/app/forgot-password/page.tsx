import { Suspense } from "react";
import ForgotPasswordForm from "./forgot-password-form";

export const metadata = {
  title: "Forgot Password",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white px-4 py-8">
      <Suspense fallback={<div className="text-zinc-500">Loading...</div>}>
        <ForgotPasswordForm />
      </Suspense>
    </div>
  );
}