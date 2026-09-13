import LegalLayout from "@/app/components/legal-layout";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Mail, Phone, MessageCircle, MapPin, Clock, Building2 } from "lucide-react";

export const metadata = {
  title: "Contact Us",
  description:
    "Get in touch with Brothers Gym owners at Nangal Raya or Sagar Pur branches.",
};

async function getBranches() {
  try {
    return await db
      .select()
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(branches.id);
  } catch {
    return [];
  }
}

export default async function ContactPage() {
  const allBranches = await getBranches();

  return (
    <LegalLayout
      title="Contact Us"
      subtitle="We're here to help. Reach out to the branch owners directly for any queries."
    >
      <div className="not-prose space-y-8">
        {/* Quick action cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
          <QuickActionCard
            icon={<MessageCircle size={24} />}
            title="WhatsApp"
            description="Quickest response — usually within 1 hour"
            color="green"
          />
          <QuickActionCard
            icon={<Phone size={24} />}
            title="Phone Call"
            description="Direct line to the branch owner"
            color="blue"
          />
          <QuickActionCard
            icon={<MapPin size={24} />}
            title="Visit Us"
            description="Drop by any of our two branches"
            color="yellow"
          />
        </div>

        {/* Detailed branch contact */}
        <div>
          <h2 className="text-2xl font-black text-white mb-6 flex items-center gap-3">
            <Building2 size={24} className="text-yellow-500" />
            Branch Contacts
          </h2>

          <div className="grid sm:grid-cols-2 gap-4 md:gap-6">
            {allBranches.map((branch) => (
              <div
                key={branch.id}
                className="bg-zinc-900 border border-zinc-800 hover:border-yellow-500/40 rounded-2xl p-6 transition-colors"
              >
                {/* Branch header */}
                <div className="flex items-center gap-3 mb-5 pb-5 border-b border-zinc-800">
                  <div className="w-14 h-14 bg-yellow-500/20 border border-yellow-500/40 rounded-xl flex items-center justify-center">
                    <Building2 size={24} className="text-yellow-500" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-white">{branch.name}</h3>
                    <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded font-black tracking-widest uppercase">
                      Branch · {branch.code}
                    </span>
                  </div>
                </div>

                {/* Owner */}
                {branch.ownerName && (
                  <div className="mb-4">
                    <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold mb-1">
                      Owner
                    </p>
                    <p className="text-white font-bold text-lg">{branch.ownerName}</p>
                  </div>
                )}

                {/* Contact methods */}
                <div className="space-y-3">
                  {branch.phone && (
                    <>
                      <a
                        href={`tel:${branch.phone}`}
                        className="flex items-center gap-3 p-3 bg-zinc-800 hover:bg-blue-500/10 hover:border-blue-500 border border-transparent rounded-lg transition-all group"
                      >
                        <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center shrink-0">
                          <Phone size={16} className="text-blue-400" />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs text-zinc-500 uppercase tracking-wider">
                            Call
                          </p>
                          <p className="text-white font-bold">{branch.phone}</p>
                        </div>
                      </a>

                      <a
                        href={`https://wa.me/${branch.phone.replace(/\D/g, "")}?text=${encodeURIComponent(
                          `Hi ${branch.ownerName || "Brothers Gym"}! I want to know more about Brothers Gym ${branch.name} membership.`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 bg-zinc-800 hover:bg-green-500/10 hover:border-green-500 border border-transparent rounded-lg transition-all group"
                      >
                        <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center shrink-0">
                          <MessageCircle size={16} className="text-green-400" />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs text-zinc-500 uppercase tracking-wider">
                            WhatsApp
                          </p>
                          <p className="text-white font-bold">{branch.phone}</p>
                        </div>
                      </a>
                    </>
                  )}

                  {branch.ownerEmail && (
                    <a
                      href={`mailto:${branch.ownerEmail}`}
                      className="flex items-center gap-3 p-3 bg-zinc-800 hover:bg-yellow-500/10 hover:border-yellow-500 border border-transparent rounded-lg transition-all group"
                    >
                      <div className="w-10 h-10 bg-yellow-500/20 rounded-lg flex items-center justify-center shrink-0">
                        <Mail size={16} className="text-yellow-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-zinc-500 uppercase tracking-wider">
                          Email
                        </p>
                        <p className="text-white font-bold text-sm truncate">
                          {branch.ownerEmail}
                        </p>
                      </div>
                    </a>
                  )}
                </div>

                {/* Address */}
                <div className="mt-5 pt-5 border-t border-zinc-800">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold mb-2">
                    Address
                  </p>
                  <p className="text-zinc-300 text-sm leading-relaxed mb-3">
                    {branch.address}
                  </p>
                  <a
                    href={branch.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-bold text-yellow-500 hover:text-yellow-400"
                  >
                    <MapPin size={12} /> Get Directions →
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Opening hours */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h2 className="text-xl font-black text-white mb-4 flex items-center gap-3">
            <Clock size={20} className="text-yellow-500" />
            Opening Hours
          </h2>

          <div className="grid sm:grid-cols-2 gap-3 md:gap-4">
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
              <p className="text-[10px] font-black text-yellow-500 uppercase tracking-widest mb-2">
                Nangal Raya (Full Day)
              </p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Mon – Sat</span>
                <span className="text-white font-bold">5:30 AM – 10:00 PM</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-zinc-400">Sunday</span>
                <span className="text-red-400 font-bold">Closed</span>
              </div>
            </div>

            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
              <p className="text-[10px] font-black text-yellow-500 uppercase tracking-widest mb-2">
                Sagar Pur (Split Timings)
              </p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Morning</span>
                <span className="text-white font-bold">5:30 AM – 12:00 PM</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-zinc-400">Evening</span>
                <span className="text-white font-bold">4:00 PM – 10:00 PM</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-zinc-400">Sunday</span>
                <span className="text-red-400 font-bold">Closed</span>
              </div>
            </div>
          </div>
        </div>

        {/* Response time */}
        <div className="bg-yellow-500/5 border border-yellow-500/30 rounded-xl p-5">
          <h3 className="text-lg font-bold text-yellow-500 mb-3">
            Response Time Expectations
          </h3>
          <ul className="text-sm text-zinc-300 space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              <span>
                <strong>WhatsApp:</strong> Usually within 1 hour during business hours
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-400">•</span>
              <span>
                <strong>Phone:</strong> Available during gym hours
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-yellow-400">•</span>
              <span>
                <strong>Email:</strong> Within 24-48 hours
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-400">•</span>
              <span>
                <strong>Legal/Grievance:</strong> Within 30 days (per DPDP Act 2023)
              </span>
            </li>
          </ul>
        </div>
      </div>
    </LegalLayout>
  );
}

function QuickActionCard({
  icon,
  title,
  description,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: "green" | "blue" | "yellow";
}) {
  const colors = {
    green: "bg-green-500/10 border-green-500/30 text-green-400",
    blue: "bg-blue-500/10 border-blue-500/30 text-blue-400",
    yellow: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
  };

  return (
    <div className={`border-2 ${colors[color]} rounded-2xl p-5 text-center`}>
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-zinc-900 mb-3">
        {icon}
      </div>
      <h3 className="text-lg font-black text-white mb-1">{title}</h3>
      <p className="text-xs text-zinc-400">{description}</p>
    </div>
  );
}