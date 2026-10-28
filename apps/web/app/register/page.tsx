import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ActionForm } from "@/components/auth/action-form";
import { PasswordInput } from "@/components/auth/password-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpAction } from "@/lib/auth/actions";

export const metadata = { title: "Create account — ITG TraderOS" };

export default function RegisterPage() {
  return (
    <AuthCard title="Create your account" subtitle="Start your trading journal — onboarding takes a few minutes, and you can skip anything you don't have.">
      <ActionForm action={signUpAction} submitLabel="Create account">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" autoComplete="name" required placeholder="Your full name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput id="password" name="password" autoComplete="new-password" required />
          <p className="text-xs text-muted-foreground">At least 8 characters, with an uppercase letter, a lowercase letter and a number.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required />
        </div>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
