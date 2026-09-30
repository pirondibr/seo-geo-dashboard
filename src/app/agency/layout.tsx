import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  if (!(await isLoggedIn())) redirect("/login");
  return (
    <div className="wrap">
      <header className="topbar">
        <Link href="/agency" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
          GEO Dashboard
        </Link>
        <LogoutButton />
      </header>
      {children}
    </div>
  );
}
