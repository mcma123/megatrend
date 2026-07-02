import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const [numbers, setNumbers] = useState<number[]>([])

  return (
    <main className="p-8 flex flex-col gap-16">
      <h1 className="text-4xl font-bold text-center">
        Megatrend Starter
      </h1>
      <div className="flex flex-col gap-8 max-w-lg mx-auto">
        <p>Welcome.</p>
        <p>
          The database integration has been removed from this app. This route now uses local UI state only.
        </p>
        <p>
          <button
            className="bg-dark dark:bg-light text-light dark:text-dark text-sm px-4 py-2 rounded-md border-2"
            onClick={() => {
              setNumbers((current) => [...current, Math.floor(Math.random() * 10)])
            }}
          >
            Add a random number
          </button>
        </p>
        <p>
          Numbers:{' '}
          {numbers.length === 0 ? 'Click the button!' : numbers.join(', ')}
        </p>
        <p>
          Edit{' '}
          <code className="text-sm font-bold font-mono bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded-md">
            src/routes/index.tsx
          </code>{' '}
          to change this page
        </p>
        <p>
          Open{' '}
          <Link
            to="/anotherPage"
            className="text-blue-600 underline hover:no-underline"
          >
            another page
          </Link>{' '}
          for a second route.
        </p>
        <div className="flex flex-col">
          <p className="text-lg font-bold">Useful resources:</p>
          <div className="flex gap-2">
            <div className="flex flex-col gap-2 w-1/2">
              <ResourceCard
                title="TanStack Start"
                description="Read the framework docs for routing, loaders, and server functions."
                href="https://tanstack.com/start"
              />
              <ResourceCard
                title="TypeScript docs"
                description="Reference the language handbook and core type system guidance."
                href="https://www.typescriptlang.org/docs/handbook/2/basic-types.html"
              />
            </div>
            <div className="flex flex-col gap-2 w-1/2">
              <ResourceCard
                title="React docs"
                description="Reference modern React APIs and patterns."
                href="https://react.dev"
              />
              <ResourceCard
                title="Vite docs"
                description="Review build and dev server behavior for the app."
                href="https://vite.dev"
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

function ResourceCard({
  title,
  description,
  href,
}: {
  title: string
  description: string
  href: string
}) {
  return (
    <div className="flex flex-col gap-2 bg-slate-200 dark:bg-slate-800 p-4 rounded-md h-28 overflow-auto">
      <a href={href} className="text-sm underline hover:no-underline">
        {title}
      </a>
      <p className="text-xs">{description}</p>
    </div>
  )
}

