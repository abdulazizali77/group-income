'use strict'
import incomeDistribution from '~/frontend/utils/distribution/mincome-proportional.js'
import { lastDayOfMonth, dateFromMonthstamp, dateToMonthstamp, prevMonthstamp } from '~/frontend/utils/time.js'

// Merges multiple payments between any combinations two of users:
function reduceDistribution (payments: Array<Object>): Array<Object> {
  // Don't modify the payments list/object parameter in-place, as this is not intended:
  payments = JSON.parse(JSON.stringify(payments))
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
        paymentA.total += (paymentA.from === paymentB.from ? 1 : -1) * paymentB.total
        // Remove paymentB from payments, and decrement the inner sentinal loop variable:
        payments = payments.filter((payment) => payment !== paymentB)
        j--
      }
    }
  }
  return payments
}

// DRYing function meant for accumulating late payments from a previous cycle
function addDistributions (paymentsA: Array<Object>, paymentsB: Array<Object>): Array<Object> {
  return reduceDistribution([paymentsA, paymentsB].flat())
}

// DRYing function meant for chipping away a cycle's todoPayments distribution using that cycle's completedMonthlyPayments:
function subtractDistributions (paymentsA: Array<Object>, paymentsB: Array<Object>): Array<Object> {
  // Don't modify any payment list/objects parameters in-place, as this is not intended:
  paymentsB = JSON.parse(JSON.stringify(paymentsB))

  // Reverse the sign of the second operand's amounts so that the final addition is actually subtraction:
  paymentsB = paymentsB.map((p) => {
    p.amount *= -1
    p.total *= -1
    return p
  })

  return addDistributions(paymentsA, paymentsB)
}

// This algorithm is responsible for calculating the monthly-rated distribution of
// payments.
function parseMonthlyDistributionFromEvents (distributionEvents: Array<Object>, minCome: number, adjusted: Boolean): Array<Object> {
  distributionEvents = JSON.parse(JSON.stringify(distributionEvents))

  // The following list variable is for DRYing out our calculations of the each cycle's final
  // income distributions.
  let groupMembers = []

  // Convenience function for retreiving a user by name:
  const getUser = name => groupMembers.find(member => member.name === name)

  // Make a place to store this and the previous cycle's startCycleEvent (where over/under-payments are stored)
  // so that they can be included in the next cycle's payment distribution calculations:
  let startCycleEvent = { data: { monthlyDistribution: [], completedPayments: [] } }
  let lastStartCycleEvent = {}
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

  const handleCycleEvent = (event, artificialEndEvent = false) => {
    lastStartCycleEvent = JSON.parse(JSON.stringify(startCycleEvent))
    monthlyDistribution = paymentsDistribution(groupMembers, minCome).map((payment) => {
      payment.total = payment.amount
      return payment
    })

    // Check if it is the last event (the next month after monthstamps cycle event), or if the
    // final distribution should be adjusted, anyway:
    monthlyDistribution = subtractDistributions(monthlyDistribution, completedMonthlyPayments)

    monthlyDistribution.forEach((v) => {
      v.partial = (v.total !== v.amount)
    })

    startCycleEvent = event
    startCycleEvent.data.monthlyDistribution = monthlyDistribution
    startCycleEvent.data.completedPayments = completedMonthlyPayments

    completedMonthlyPayments = [] // and the monthly payments, too...
  }

  const handleIncomeEvent = (event) => {
    const oldUser = getUser(event.data.name)
    if (oldUser) {
      oldUser.haveNeed = event.data.haveNeed
    } else {
      // Add the user who declared their income to our groupMembers list variable
      groupMembers.push({
        name: event.data.name,
        haveNeed: event.data.haveNeed
      })
    }
  }

  const handlePaymentEvent = (event) => {
    completedMonthlyPayments.push({
      from: event.data.from,
      to: event.data.to,
      amount: event.data.amount,
      total: 0
    })
  }

  const handleExitEvent = (event) => {
    groupMembers = groupMembers.filter((v) => { return v.name !== event.data.name })
  }

  // Loop through the events, pro-rating each user's monthly pledges/needs:
  distributionEvents.forEach((event) => {
    if (event.type === 'startCycleEvent') {
      handleCycleEvent(event)
    } else if (event.type === 'haveNeedEvent') {
      handleIncomeEvent(event)
    } else if (event.type === 'paymentEvent') {
      handlePaymentEvent(event)
    } else if (event.type === 'userExitsGroupEvent') {
      handleExitEvent(event)
    }
  })

  const lastWhen = distributionEvents[distributionEvents.length - 1].data.when

  const artificialEnd = {
    type: 'startCycleEvent',
    data: {
      when: lastWhen,
      monthlyDistribution: [] // List to be populated later, by the events-parser
    }
  }
  handleCycleEvent(artificialEnd, true)

  // "Overpayments sometimes occur *internally* as a result of people leaving, joining, and (re-)setting income.
  // Our task is to redistribute the overpayments back into the current late payments so nobody in need is asked to pay.
  let overPayments = JSON.parse(JSON.stringify(lastStartCycleEvent.data.monthlyDistribution)).filter((p) => {
    return p.amount < 0
  })

  startCycleEvent.data.monthlyDistribution = addDistributions(startCycleEvent.data.monthlyDistribution, overPayments)

  if (!adjusted) {
    startCycleEvent.data.monthlyDistribution = addDistributions(startCycleEvent.data.completedPayments, startCycleEvent.data.monthlyDistribution)
  }

  overPayments = JSON.parse(JSON.stringify(startCycleEvent.data.monthlyDistribution)).filter((p) => {
    return p.amount < 0
  })

  lastStartCycleEvent.data.monthlyDistribution = addDistributions(lastStartCycleEvent.data.monthlyDistribution, overPayments)
  // Unadjust last
  if (!adjusted) {
    lastStartCycleEvent.data.monthlyDistribution = addDistributions(lastStartCycleEvent.data.completedPayments, lastStartCycleEvent.data.monthlyDistribution)
  }

  lastStartCycleEvent.data.monthlyDistribution.forEach((payment) => {
    payment.amount = Math.min(payment.amount, payment.total)
    payment.isLate = true
    payment.dueOn = dateToMonthstamp(lastDayOfMonth(dateFromMonthstamp(prevMonthstamp(dateToMonthstamp(new Date(lastWhen))))))
  })
  startCycleEvent.data.monthlyDistribution.forEach((payment) => {
    payment.amount = Math.min(payment.amount, payment.total)
    payment.isLate = false
    payment.dueOn = dateToMonthstamp(lastDayOfMonth(dateFromMonthstamp(dateToMonthstamp(new Date(lastWhen)))))
  })

  const previousTwoCycles = [
    lastStartCycleEvent.data.monthlyDistribution,
    startCycleEvent.data.monthlyDistribution
  ].flat()

  return previousTwoCycles.filter((payment) => {
    return payment.from !== payment.to // This happens when a haver switches to being a needer; remove neutral distribution payments.
  }) // TODO: return late-payments as well.
}

export default parseMonthlyDistributionFromEvents