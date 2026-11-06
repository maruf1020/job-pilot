import type { Metadata } from 'next'
import { ProfileForm } from '@/components/settings/profile-form'
import { ResumeCard } from '@/components/settings/resume-card'

export const metadata: Metadata = { title: 'Profile' }

export default function ProfileSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <ResumeCard />
      <ProfileForm />
    </div>
  )
}
