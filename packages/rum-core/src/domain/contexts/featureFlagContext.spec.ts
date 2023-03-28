import type { RelativeTime } from '@datadog/browser-core'
import { resetExperimentalFeatures, updateExperimentalFeatures, relativeToClocks } from '@datadog/browser-core'
import type { Clock } from '../../../../core/test/specHelper'
import type { LifeCycle } from '../lifeCycle'
import type { TestSetupBuilder } from '../../../test/testSetupBuilder'
import { setup } from '../../../test/testSetupBuilder'
import { LifeCycleEventType } from '../lifeCycle'
import type { ViewCreatedEvent, ViewEndedEvent } from '../rumEventsCollection/view/trackViews'
import type { FeatureFlagContexts } from './featureFlagContext'
import { BYTES_COMPUTATION_THROTTLING_DELAY, startFeatureFlagContexts } from './featureFlagContext'

describe('featureFlagContexts', () => {
  let setupBuilder: TestSetupBuilder
  let featureFlagContexts: FeatureFlagContexts
  let computeBytesCountStub: jasmine.Spy

  beforeEach(() => {
    setupBuilder = setup().beforeBuild(({ lifeCycle }) => {
      computeBytesCountStub = jasmine.createSpy('computeBytesCountStub').and.returnValue(1)
      featureFlagContexts = startFeatureFlagContexts(lifeCycle, computeBytesCountStub)
    })
  })

  afterEach(() => {
    resetExperimentalFeatures()
    setupBuilder.cleanup()
  })

  it('should return undefined before the initial view', () => {
    setupBuilder.build()

    expect(featureFlagContexts.findFeatureFlagEvaluations()).toBeUndefined()
  })

  describe('addFeatureFlagEvaluation', () => {
    it('should add feature flag evaluations of any type when the ff feature_flags is enabled', () => {
      updateExperimentalFeatures(['feature_flags'])

      const { lifeCycle } = setupBuilder.build()

      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
        startClocks: relativeToClocks(0 as RelativeTime),
      } as ViewCreatedEvent)

      featureFlagContexts.addFeatureFlagEvaluation('feature', 'foo')
      featureFlagContexts.addFeatureFlagEvaluation('feature2', 2)
      featureFlagContexts.addFeatureFlagEvaluation('feature3', true)
      featureFlagContexts.addFeatureFlagEvaluation('feature4', { foo: 'bar' })

      const featureFlagContext = featureFlagContexts.findFeatureFlagEvaluations()!

      expect(featureFlagContext).toEqual({
        feature: 'foo',
        feature2: 2,
        feature3: true,
        feature4: { foo: 'bar' },
      })
    })

    it('should replace existing feature flag evaluation to the current context when the ff feature_flags is enabled', () => {
      updateExperimentalFeatures(['feature_flags'])

      const { lifeCycle } = setupBuilder.build()

      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
        startClocks: relativeToClocks(0 as RelativeTime),
      } as ViewCreatedEvent)

      featureFlagContexts.addFeatureFlagEvaluation('feature', 'foo')
      featureFlagContexts.addFeatureFlagEvaluation('feature2', 'baz')
      featureFlagContexts.addFeatureFlagEvaluation('feature', 'bar')

      const featureFlagContext = featureFlagContexts.findFeatureFlagEvaluations()!

      expect(featureFlagContext).toEqual({ feature: 'bar', feature2: 'baz' })
    })

    it('should not add feature flag evaluation when the ff feature_flags is disabled', () => {
      const { lifeCycle } = setupBuilder.build()

      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
        startClocks: relativeToClocks(0 as RelativeTime),
      } as ViewCreatedEvent)

      featureFlagContexts.addFeatureFlagEvaluation('feature', 'foo')

      const featureFlagContext = featureFlagContexts.findFeatureFlagEvaluations()!

      expect(featureFlagContext).toBeUndefined()
    })
  })

  describe('findFeatureFlagEvaluations', () => {
    /**
     * It could happen if there is an event happening just between view end and view creation
     * (which seems unlikely) and this event would anyway be rejected by lack of view id
     */
    it('should return undefined when no current view', () => {
      updateExperimentalFeatures(['feature_flags'])

      setupBuilder.build()

      expect(featureFlagContexts.findFeatureFlagEvaluations()).toBeUndefined()
    })

    it('should clear feature flag context on new view', () => {
      updateExperimentalFeatures(['feature_flags'])

      const { lifeCycle } = setupBuilder.build()

      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
        startClocks: relativeToClocks(0 as RelativeTime),
      } as ViewCreatedEvent)
      featureFlagContexts.addFeatureFlagEvaluation('feature', 'foo')
      lifeCycle.notify(LifeCycleEventType.VIEW_ENDED, {
        endClocks: relativeToClocks(10 as RelativeTime),
      } as ViewEndedEvent)
      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
        startClocks: relativeToClocks(10 as RelativeTime),
      } as ViewCreatedEvent)

      const featureFlagContext = featureFlagContexts.findFeatureFlagEvaluations()!
      expect(featureFlagContext).toEqual({})
    })

    it('should return the feature flag context corresponding to the start time', () => {
      updateExperimentalFeatures(['feature_flags'])

      const { lifeCycle, clock } = setupBuilder.withFakeClock().build()

      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
        startClocks: relativeToClocks(0 as RelativeTime),
      } as ViewCreatedEvent)

      clock.tick(10)
      featureFlagContexts.addFeatureFlagEvaluation('feature', 'one')
      lifeCycle.notify(LifeCycleEventType.VIEW_ENDED, {
        endClocks: relativeToClocks(10 as RelativeTime),
      } as ViewEndedEvent)
      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
        startClocks: relativeToClocks(10 as RelativeTime),
      } as ViewCreatedEvent)

      clock.tick(10)
      featureFlagContexts.addFeatureFlagEvaluation('feature', 'two')

      expect(featureFlagContexts.findFeatureFlagEvaluations(5 as RelativeTime)).toEqual({ feature: 'one' })
      expect(featureFlagContexts.findFeatureFlagEvaluations(15 as RelativeTime)).toEqual({ feature: 'two' })
    })
  })

  describe('bytes count computation', () => {
    let clock: Clock
    let lifeCycle: LifeCycle

    beforeEach(() => {
      updateExperimentalFeatures(['feature_flags'])
      ;({ clock, lifeCycle } = setupBuilder.withFakeClock().build())
      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
        startClocks: relativeToClocks(0 as RelativeTime),
      } as ViewCreatedEvent)
    })

    it('should be done each time the context is updated', () => {
      featureFlagContexts.addFeatureFlagEvaluation('feature1', 'foo')
      clock.tick(BYTES_COMPUTATION_THROTTLING_DELAY)
      featureFlagContexts.addFeatureFlagEvaluation('feature2', 'bar')
      clock.tick(BYTES_COMPUTATION_THROTTLING_DELAY)

      // feature flags are cleared when a view is created
      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
        startClocks: relativeToClocks(10 as RelativeTime),
      } as ViewCreatedEvent)
      const bytesCount = featureFlagContexts.getFeatureFlagBytesCount()

      expect(bytesCount).toEqual(0)
      expect(computeBytesCountStub).toHaveBeenCalledTimes(2)
    })

    it('should be throttled to minimize the impact on performance', () => {
      featureFlagContexts.addFeatureFlagEvaluation('feature1', 'foo') // leading call executed synchronously
      featureFlagContexts.addFeatureFlagEvaluation('feature2', 'bar') // ignored
      featureFlagContexts.addFeatureFlagEvaluation('feature3', 'baz') // trailing call executed after BYTES_COMPUTATION_THROTTLING_DELAY
      clock.tick(BYTES_COMPUTATION_THROTTLING_DELAY)

      expect(computeBytesCountStub).toHaveBeenCalledTimes(2)
    })
  })
})
