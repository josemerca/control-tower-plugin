import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivePlan } from 'app/active-plans/ActivePlan.types'
import { ActivePlansClient } from 'app/active-plans/client'
import { ImplementPlanAction } from 'app/implement-plan/components/implement-plan-action'
import { PlanProgress } from 'app/plan-events/components/plan-progress'
import { StartPlanForm } from 'app/start-plan/components/start-plan-form'
import { StartedPlan, StartPlanRequest } from 'app/start-plan/StartPlan.types'
import { WorkflowSnapshot, WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { TopBar } from 'system-ui/top-bar'
import { WorkflowStep, WorkflowStepStatus } from 'system-ui/workflow-step'
import './Home.css'

type WorkflowStepName = 'request' | 'plan' | 'implementation'
type Reconciliation = 'not-required' | 'checking' | 'confirmed' | 'stale' | 'unavailable' | 'uncertain' | 'uncertain-start'

const isSameWorkflow = (workflow: WorkflowSnapshot, active: ActivePlan) =>
  workflow.request.id === active.request.id &&
  workflow.request.repo === active.request.repo &&
  workflow.plan.id === active.plan.id &&
  workflow.plan.repo === active.plan.repo &&
  workflow.plan.issue.number === active.plan.issue.number &&
  workflow.plan.agent === active.plan.agent

const isSameRequest = (request: StartPlanRequest, active: ActivePlan) =>
  request.id === active.request.id && request.repo === active.request.repo && request.path === active.request.path

const Home = () => {
  const [workflow, setWorkflow] = useState<WorkflowSnapshot | null>(() => WorkflowSnapshotStorage.load())
  const workflowRef = useRef(workflow)
  const restoredRef = useRef(workflow !== null)
  const [reconciliation, setReconciliation] = useState<Reconciliation>(workflow === null ? 'not-required' : 'checking')
  const [candidates, setCandidates] = useState<ActivePlan[]>([])
  const [uncertainRequest, setUncertainRequest] = useState<StartPlanRequest | null>(null)
  const [expandedStep, setExpandedStep] = useState<WorkflowStepName>(() => {
    if (workflow?.phase === 'planning') return 'plan'
    if (workflow !== null) return 'implementation'
    return 'request'
  })
  const [requestFormVersion, setRequestFormVersion] = useState(0)
  const recoveryStartedRef = useRef(false)
  const recoveryTokenRef = useRef<symbol | null>(null)
  const mountedRef = useRef(false)

  const selectWorkflow = useCallback((selected: WorkflowSnapshot, restored = true) => {
    workflowRef.current = selected
    restoredRef.current = restored
    setWorkflow(selected)
    setReconciliation(restored ? 'confirmed' : 'not-required')
    setCandidates([])
    setUncertainRequest(null)
    setExpandedStep(selected.phase === 'planning' ? 'plan' : 'implementation')
    WorkflowSnapshotStorage.save(selected)
  }, [])

  const selectActivePlan = useCallback((active: ActivePlan) => {
    if (active.phase === 'uncertain') {
      workflowRef.current = null
      restoredRef.current = false
      setWorkflow(null)
      setUncertainRequest(active.request)
      setCandidates([])
      setExpandedStep('request')
      setReconciliation('uncertain')
      return
    }
    selectWorkflow({ phase: active.phase, request: active.request, plan: active.plan })
  }, [selectWorkflow])

  const reconcile = useCallback(async (submittedRequest?: StartPlanRequest) => {
    const token = Symbol('recovery')
    recoveryTokenRef.current = token
    const outcome = await ActivePlansClient.get()
    if (!mountedRef.current || recoveryTokenRef.current !== token) return

    const current = workflowRef.current
    if (current !== null && restoredRef.current) {
      if (outcome.kind === 'unavailable') {
        setReconciliation('unavailable')
        return
      }

      const active = outcome.plans.find((candidate) => isSameWorkflow(current, candidate))
      if (active === undefined) {
        setReconciliation('stale')
        return
      }

      if (active.phase === 'uncertain') {
        setReconciliation('uncertain')
        return
      }

      const reconciled: WorkflowSnapshot = {
        ...current,
        phase: active.phase === 'implementing' ? 'implementing' : current.phase === 'ready' ? 'ready' : 'planning',
      }
      workflowRef.current = reconciled
      setWorkflow(reconciled)
      setExpandedStep(reconciled.phase === 'planning' ? 'plan' : 'implementation')
      setReconciliation('confirmed')
      WorkflowSnapshotStorage.save(reconciled)
      return
    }

    if (current !== null) return
    if (submittedRequest !== undefined) {
      if (outcome.kind === 'unavailable') {
        setReconciliation('unavailable')
        return
      }
      const active = outcome.plans.find((candidate) => isSameRequest(submittedRequest, candidate))
      if (active === undefined) {
        setReconciliation('uncertain-start')
        return
      }
      selectActivePlan(active)
      return
    }
    if (outcome.kind === 'unavailable') return
    if (outcome.plans.length === 1) {
      selectActivePlan(outcome.plans[0])
    } else if (outcome.plans.length > 1) {
      setCandidates(outcome.plans)
    }
  }, [selectActivePlan])

  useEffect(() => {
    mountedRef.current = true
    if (!recoveryStartedRef.current) {
      recoveryStartedRef.current = true
      void reconcile()
    }

    return () => {
      mountedRef.current = false
    }
  }, [reconcile])

  const formInteracted = useCallback(() => {
    recoveryTokenRef.current = null
    setCandidates([])
  }, [])

  const expand = (step: WorkflowStepName) => (isExpanded: boolean) => {
    if (isExpanded) setExpandedStep(step)
  }

  const planStarted = useCallback(
    (plan: StartedPlan, request: StartPlanRequest) => {
      if (workflowRef.current !== null) return
      selectWorkflow({ phase: 'planning', request, plan }, false)
    },
    [selectWorkflow],
  )

  const planStartUncertain = useCallback((request: StartPlanRequest) => {
    if (workflowRef.current !== null) return
    setUncertainRequest(request)
    setCandidates([])
    setReconciliation('checking')
    void reconcile(request)
  }, [reconcile])

  const planReady = useCallback(() => {
    const current = workflowRef.current
    if (current === null || current.phase === 'implementing') return
    const ready: WorkflowSnapshot = { ...current, phase: 'ready' }
    workflowRef.current = ready
    setWorkflow(ready)
    WorkflowSnapshotStorage.save(ready)
    setExpandedStep('implementation')
  }, [])

  const implementationStarted = useCallback(() => {
    const current = workflowRef.current
    if (current === null) return
    const implementing: WorkflowSnapshot = { ...current, phase: 'implementing' }
    workflowRef.current = implementing
    setWorkflow(implementing)
    WorkflowSnapshotStorage.save(implementing)
  }, [])

  const discardWorkflow = () => {
    recoveryTokenRef.current = null
    workflowRef.current = null
    restoredRef.current = false
    setWorkflow(null)
    setReconciliation('not-required')
    setCandidates([])
    setUncertainRequest(null)
    setExpandedStep('request')
    setRequestFormVersion((version) => version + 1)
    WorkflowSnapshotStorage.remove()
  }

  const retryReconciliation = () => {
    setReconciliation('checking')
    void reconcile(uncertainRequest ?? undefined)
  }

  const restoredNeedsRecovery = restoredRef.current && (reconciliation === 'stale' || reconciliation === 'unavailable' || reconciliation === 'uncertain')
  const restoredIsConfirmed = !restoredRef.current || reconciliation === 'confirmed'
  const showRestoredDiscard = restoredRef.current && workflow?.phase !== 'implementing' && !restoredNeedsRecovery

  const requestStatus: WorkflowStepStatus = workflow === null ? 'active' : 'completed'
  const planStatus: WorkflowStepStatus = workflow === null ? 'pending' : workflow.phase === 'planning' ? 'active' : 'completed'
  const implementationStatus: WorkflowStepStatus = workflow?.phase === 'ready' || workflow?.phase === 'implementing' ? 'active' : 'pending'

  return (
    <div className="home">
      <TopBar productName="Control Tower" logo={<span className="home__logo">CT</span>} />
      <main className="home__content">
        <WorkflowStep
          title="Solicitud"
          status={requestStatus}
          isExpanded={expandedStep === 'request'}
          canCollapse={expandedStep !== 'request'}
          onExpandedChange={expand('request')}
        >
          {candidates.length > 1 && workflow === null && (
            <ul className="home__active-plans" aria-label="Planes activos">
              {candidates.map((candidate) => (
                <li key={`${candidate.plan.repo}:${candidate.plan.issue.number}`} className="home__active-plan">
                  <span>
                    <strong>{candidate.request.id}</strong> · <code>{candidate.request.repo}</code> · issue #{candidate.plan.issue.number}
                  </span>
                  <Button
                    variant="secondary"
                    aria-label={`Continuar plan ${candidate.request.id}, ${candidate.request.repo}, issue #${candidate.plan.issue.number}`}
                    onClick={() => selectActivePlan(candidate)}
                  >
                    Continuar plan
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {workflow === null || candidates.length <= 1 ? (
            <StartPlanForm
              key={requestFormVersion}
              onStarted={planStarted}
              onBackendUnreachable={planStartUncertain}
              onInteraction={formInteracted}
              isLocked={workflow !== null || uncertainRequest !== null}
              request={workflow?.request ?? uncertainRequest ?? undefined}
            />
          ) : null}
        </WorkflowStep>
        {reconciliation === 'checking' && (restoredRef.current || uncertainRequest !== null) && (
          <div className="home__recovery">
            <Banner type="informative" title="Comprobando que el plan sigue activo" />
            {workflow?.phase !== 'implementing' && (
              <Button variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
            )}
          </div>
        )}
        {reconciliation === 'stale' && (
          <div className="home__recovery">
            <Banner
              type="warning"
              role="alert"
              title="El plan guardado ya no está activo"
              description="El backend o cmux ya no tiene este plan activo. Descarta el estado para crear una solicitud nueva."
            />
            <Button variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
          </div>
        )}
        {reconciliation === 'unavailable' && (
          <div className="home__recovery">
            <Banner
              type="warning"
              role="alert"
              title={restoredRef.current ? 'No se pudo comprobar el plan guardado' : 'No se pudo comprobar el estado del plan'}
              description="No se pudo contactar con el backend. No se harán acciones hasta que se confirme el estado."
            />
            <div className="home__recovery-actions">
              <Button onClick={retryReconciliation}>Reintentar</Button>
              <Button variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
            </div>
          </div>
        )}
        {(reconciliation === 'uncertain' || reconciliation === 'uncertain-start') && (
          <div className="home__recovery">
            <Banner
              type="warning"
              role="alert"
              title={reconciliation === 'uncertain-start' ? 'No se puede confirmar si el plan arrancó' : 'No se puede confirmar el estado de implementación'}
              description={reconciliation === 'uncertain-start'
                ? 'La solicitud puede completarse más tarde. Reintenta la recuperación o descarta el estado para crear otra solicitud.'
                : 'No se abrirán eventos ni se podrá implementar hasta que el backend confirme el estado.'}
            />
            <div className="home__recovery-actions">
              <Button onClick={retryReconciliation}>Reintentar recuperación</Button>
              <Button variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
            </div>
          </div>
        )}
        {workflow !== null && (
          <WorkflowStep
            title="Plan"
            status={planStatus}
            isExpanded={expandedStep === 'plan'}
            canCollapse={expandedStep !== 'plan'}
            onExpandedChange={expand('plan')}
          >
            {workflow.phase !== 'implementing' && restoredIsConfirmed && (
              <PlanProgress
                key={`${workflow.plan.repo}:${workflow.plan.issue.number}`}
                plan={workflow.plan}
                onReady={planReady}
              />
            )}
            {showRestoredDiscard && workflow.phase === 'planning' && (
              <Button className="home__discard" variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
            )}
          </WorkflowStep>
        )}
        <WorkflowStep
          title="Implementación"
          status={implementationStatus}
          isExpanded={expandedStep === 'implementation'}
          canCollapse={expandedStep !== 'implementation'}
          onExpandedChange={expand('implementation')}
        >
          {workflow !== null && workflow.phase !== 'planning' && restoredIsConfirmed && (
            <ImplementPlanAction
              plan={workflow.plan}
              onImplementationStarted={implementationStarted}
              isImplementationStarted={workflow.phase === 'implementing'}
            />
          )}
          {showRestoredDiscard && workflow?.phase === 'ready' && (
            <Button className="home__discard" variant="secondary" onClick={discardWorkflow}>Descartar estado</Button>
          )}
          {workflow?.phase === 'implementing' && restoredIsConfirmed && (
            <Button className="home__start-another" type="button" variant="secondary" onClick={discardWorkflow}>
              Arrancar otro plan
            </Button>
          )}
        </WorkflowStep>
      </main>
    </div>
  )
}

export { Home }
