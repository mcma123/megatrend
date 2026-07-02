import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/anotherPage')({
  component: AnotherPage,
})

function AnotherPage() {
  const [message, setMessage] = useState('No action has been triggered yet.')

  return (
    <main className="p-8 flex flex-col gap-16">
      <h1 className="text-4xl font-bold text-center">
        Another Page
      </h1>
      <div className="flex flex-col gap-8 max-w-lg mx-auto">
        <p>{message}</p>
        <p>Click the button below to run a local-only demo action.</p>
        <p>
          <button
            className="bg-dark dark:bg-light text-light dark:text-dark text-sm px-4 py-2 rounded-md border-2"
            onClick={() => {
              setMessage(`Local action completed with value ${Math.round(Math.random() * 100)}.`)
            }}
          >
            Run local action
          </button>
        </p>
        <Link to="/" className="text-blue-600 underline hover:no-underline">
          Back
        </Link>
      </div>
    </main>
  )
}
