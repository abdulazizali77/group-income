'use strict'
import { firstDayOfMonth } from '~/frontend/utils/time.js'
import incomeDistribution from '~/frontend/utils/distribution/mincome-proportional.js'

const monthlyRated = true // True if time-weighted monthly, false if purely pro-rated

// This helper function inserts monthly-balance-events between the
// distributionEvents which happen on different cycles. This is so
// that every event can be pro-rated such that there is a convenient
// place for tracking/storing over/under-payments between cycles.
function insertMonthlyCycleEvents (distributionEvents: Array<Object>): Array<any | Object> {
  const newEvents = []
  let lastCycleStartEvent = distributionEvents[0] // Guaranteed to be the first event (from group creation).
  for (const event of distributionEvents) {
    for (let monthCounter = 1; lastCycleStartEvent.data.cycle + monthCounter <= Math.floor(event.data.cycle); monthCounter++) {
      const whenDate = firstDayOfMonth(new Date(lastCycleStartEvent.data.when))
      whenDate.setMonth(whenDate.getMonth() + monthCounter)
      const cycleStartEvent = {
        type: 'startCycleEvent',
        data: {
          cycle: lastCycleStartEvent.data.cycle + monthCounter,
          when: whenDate.toISOString(),
          latePayments: [] // List to be populated later, by the events-parser
        }
      }
      lastCycleStartEvent = cycleStartEvent
      newEvents.push(cycleStartEvent)
    }
    newEvents.push(event)
  }
  const whenDate = firstDayOfMonth(new Date(lastCycleStartEvent.data.when))
  whenDate.setMonth(whenDate.getMonth() + 1)
  const cycleStartEvent = {
    type: 'startCycleEvent',
    data: {
      cycle: lastCycleStartEvent.data.cycle + 1,
      when: whenDate.toISOString(),
      latePayments: [] // List to be populated later, by the events-parser
    }
  }
  newEvents.push(cycleStartEvent)
  return newEvents
}

// Flatten's out multiple payments between unique combinations of users
// for a payment distribution by adding the unique combinations' payment
// amounts based on the direction (from/to) of the payments:
function reduceDistribution (payments: Array<any | Object>): Array<any | {|from: string, to: string, amount: number|}> {
  // Don't modify the payments list/object parameter in-place, as this is not intended:
  payments = JSON.parse(JSON.stringify(payments))
  // Loop through the unique combinations of payments:
  for (let i = 0; i < payments.length; i++) {
    const paymentA = payments[i]
    for (let j = i + 1; j < payments.length; j++) {
      const paymentB = payments[j]

      // Were paymentA and paymentB between the same two users?
      if ((paymentA.from === paymentB.from && paymentA.to === paymentB.to) ||
        (paymentA.to === paymentB.from && paymentA.from === paymentB.to)) {
        // Add or subtract paymentB's amount to paymentA's amount, depending on the relative
        // direction of the two payments:
        paymentA.amount += (paymentA.from === paymentB.from ? 1 : -1) * paymentB.amount

        // Remove paymentB from payments, and decrement the inner sentinal loop variable:
        payments = payments.filter((_, paymentIndex) => { return paymentIndex !== j })
        j--
      }
    }
  }
  return payments
}

// DRYing function meant for accumulating late payments from a previous cycle
function addDistributions (paymentsA: Array<any | Object>, paymentsB: Array<any | Object>): Array<any | {|from: string, to: string, amount: number|}> {
  return reduceDistribution([paymentsA, paymentsB].flat())
}

// DRYing function meant for chipping away a cycle's todoPayments distribution using that cycle's completedMonthlyPayments:
function subtractDistributions (paymentsA: Array<any | Object>, paymentsB: Array<any | Object>): Array<any | {|from: string, to: string, amount: number|}> {
  // Don't modify any payment list/objects parameters in-place, as this is not intended:
  paymentsB = JSON.parse(JSON.stringify(paymentsB))

  // Reverse the sign of the second operand's amounts so that the final addition is actually subtraction:
  paymentsB = paymentsB.map((p) => {
    p.amount *= -1
    return p
  })

  return addDistributions(paymentsA, paymentsB)
}

// This algorithm is responsible for calculating the monthly-rated distribution of
// payments (with respect to all the events created up until the cycle of the
// 'monthstamp' parameter).
function parseMonthlyDistributionFromEvents (distributionEvents: Array<Object>, minCome: number, monthstamp: string, adjusted: Boolean): Array<any | {|from: string, to: string, amount: number|}> {
  distributionEvents = JSON.parse(JSON.stringify(distributionEvents))

  // Add blank 'startCycleEvent's in between the distributionEvents of different monthly cycles:
  distributionEvents = insertMonthlyCycleEvents(distributionEvents)

  // The following list variable is for DRYing out our calculations of the each cycle's final
  // income distributions.
  let groupMembers = []

  // Convenience function for retreiving a user by name:
  const getUser = function (userName) {
    for (const member of groupMembers) {
      if (member.name === userName) {
        return member
      }
    }
  }

  const proRateHaveNeeds = function (proRatedMembers, cyclesIntoMonth = 1) {
    for (const member of proRatedMembers) {
      const deltaCycle = (cyclesIntoMonth - member.cyclicalIncomeVariable)
      // Update the existing user's pro-rated income (cyclicalIncomeIntegral), time-variable (cyclicalIncomeVariable), and currently declared income:
      member.cyclicalIncomeVariable = cyclesIntoMonth
      member.cyclicalIncomeIntegral = monthlyRated ? member.haveNeed : member.cyclicalIncomeIntegral + deltaCycle * member.haveNeed
      member.haveNeed = member.cyclicalIncomeIntegral
    }
    return proRatedMembers
  }

  const redistributOverToLatePayments = function (overPayments, latePayments) {
    const adjustingPayments = []
    const needers = groupMembers.filter((m) => m.haveNeed < 0)
    for (const overPayment of overPayments) {
      const totalNeedByOthers = needers.reduce((acc, m) => m.name !== overPayment.to ? acc + m.haveNeed : 0, 0)
      for (const needer of needers) {
        if (needer.name !== overPayment.to) {
          adjustingPayments.push({
            from: overPayment.from,
            to: needer.name,
            amount: -overPayment.amount * needer.haveNeed / totalNeedByOthers
          })
        }
      }
    }
    return reduceDistribution([latePayments, adjustingPayments].flat())
  }

  // Make a place to store the previous cycle's startCycleEvent (where over/under-payments are stored)
  // so that they can be included in the next cycle's payment distribution calculations:
  let lastStartCycleEvent = distributionEvents[0]
  let monthlyDistribution = [] // For each cycle's monthly distribution calculation
  let completedMonthlyPayments = [] // For accumulating the payment events of each month's cycle.

  // Create a helper function for calculating each cycle's payment distribution:
  const paymentsDistribution = function (groupMembers, minCome) {
    const groupIncomes = groupMembers.map((user) => {
      return {
        name: user.name,
        amount: minCome + user.haveNeed
      }
    })
    return incomeDistribution(groupIncomes, minCome)
  }
  // Loop through the events, pro-rating each user's monthly pledges/needs:
  let eventCounter = 0
  for (const event of distributionEvents) {
    eventCounter++
    if (event.type === 'startCycleEvent') {
      monthlyDistribution = paymentsDistribution(proRateHaveNeeds(groupMembers), minCome)

      // Check if it is the last event (the next month after monthstamps cycle event), or if the
      // final distribution should be adjusted, anyway:
      if (eventCounter < distributionEvents.length || adjusted) {
        // "Double-Adjust" the monthly distribution based on the current cycle's completed payments
        monthlyDistribution = addDistributions(
          subtractDistributions(monthlyDistribution, completedMonthlyPayments),
          lastStartCycleEvent.data.latePayments)
      } else {
        // "Single-Adjust" the monthly distribution based on the previous cycle's under payments:
        monthlyDistribution = addDistributions(monthlyDistribution,
          lastStartCycleEvent.data.latePayments)
      }

      const overPayments = monthlyDistribution.filter((p) => {
        return p.amount < 0
      }).map((p) => {
        p.amount = Math.abs(p.amount)
        return p
      })

      const latePayments = monthlyDistribution.filter((p) => {
        return p.amount > 0
      })

      lastStartCycleEvent = event
      lastStartCycleEvent.data.latePayments = redistributOverToLatePayments(overPayments, latePayments)

      // Reset the income distribution calcuulation at the start of each cycle...
      for (const member of groupMembers) {
        member.cyclicalIncomeVariable = 0
        member.cyclicalIncomeIntegral = 0
      }
      completedMonthlyPayments = [] // and the monthly payments, too...
    } else if (event.type === 'haveNeedEvent') {
      const oldUser = getUser(event.data.name)
      const cyclesIntoMonth = event.data.cycle % 1
      if (oldUser) {
        oldUser.haveNeed = event.data.haveNeed
        proRateHaveNeeds([oldUser], cyclesIntoMonth)
      } else {
        // Add the user who declared their income to our groupMembers list variable
        groupMembers.push({
          name: event.data.name,
          haveNeed: event.data.haveNeed,
          cyclicalIncomeVariable: event.data.cycle % 1,
          cyclicalIncomeIntegral: 0
        })
      }
    } else if (event.type === 'paymentEvent') {
      completedMonthlyPayments.push({
        from: event.data.from,
        to: event.data.to,
        amount: event.data.amount
      })
    } else if (event.type === 'userExitsGroupEvent') {
      groupMembers = groupMembers.filter((v) => { return v.name !== event.data.name })
    }
  }

  // Since there is no final startCycleEvent, calculate the haves/needs of the group members at the
  // end of the final cycle. Then use those values as the current income distribution for
  // calculating the payments distribution. Do not adjust for this month's completed payments; that
  // is the callee's job.

  return lastStartCycleEvent.data.latePayments // TODO: return late-payments as well.
}

export default parseMonthlyDistributionFromEvents
