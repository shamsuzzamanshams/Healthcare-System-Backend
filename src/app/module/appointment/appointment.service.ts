import { success } from "zod";
import config from "../../config";
import { getBkashToken } from "../../lib/bkash";

const bookAppointment = async () => {
	const bkashIdToken = await getBkashToken();

	if (!bkashIdToken) {
		throw new Error("No bkash access token found!");
	}
	const bkashCreatePaymentResponse = await fetch(
		`${config.bkash_base_url}/tokenized/checkout/create`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: bkashIdToken,
				"X-App-Key": config.bkash_app_key,
			},

			body: JSON.stringify({
				mode: "0011",
				payerReference: "01723888888",
				callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
				merchantAssociationInfo: "MI05MID54RF09123456One",
				amount: "1200",
				currency: "BDT",
				intent: "sale",
				merchantInvoiceNumber: "Inv02",
			}),
		},
	);

	const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

	return bkashCreatePaymentResult;
};

const bookAppointmentCallback = async (query: Record<string, any>) => {
	const paymentId = query.paymentID;
	if (!paymentId) {
		throw new Error("Payment is missing");
	}
	const status = query.status;
	if (!status) {
		throw new Error("Payment Status is missing");
	}

	const bkashIdToken = await getBkashToken();

	if (!bkashIdToken) {
		throw new Error("No bkash access token found!");
	}

	const executedPaymentResponse = await fetch(
		`${config.bkash_base_url}/tokenized/checkout/execute`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: bkashIdToken,
				"X-App-Key": config.bkash_app_key,
			},

			body: JSON.stringify({
				paymentID: paymentId,
			}),
		},
	);

	const executedPaymentResult = await executedPaymentResponse.json();

	if (status === "success") {
		return {
			executedPaymentResult,
			redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=success`,
		};
	}

	if (status === "failure") {
		return {
			executedPaymentResult,
			redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=failure`,
		};
	}

	if (status === "cancel") {
		return {
			executedPaymentResult,
			redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=cancel`,
		};
	}

	return {
		executedPaymentResult,
		redirectUrl: `${config.frontend_url}/dashboard/my-appointment`
	};
};

export const AppointmentService = {
	bookAppointment,
	bookAppointmentCallback,
};
