import httpStatus from "http-status";
import config from "../config";
import AppError from "../utils/AppError";
import { redisClient } from "./redis";

export const getBkashToken = async () => {
	try {
		const IdToken = "bkash:idToken";
		const RefreshToken = "bkash:refreshToken";

		let bkashIdToken = await redisClient.get(IdToken);
		const bkashIdTokenTTL = await redisClient.ttl(IdToken);
		const bkashRefreshToken = await redisClient.get(RefreshToken);
		const bkashRefreshokenTTL = await redisClient.ttl(RefreshToken);

		if (
			(bkashIdTokenTTL <= 600 || !bkashIdToken) &&
			bkashRefreshToken &&
			bkashRefreshokenTTL > 600
		) {
			const refreshTokenResponse = await fetch(
				`${config.bkash_base_url}/tokenized/checkout/token/refresh`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
						username: config.bkash_username,
						password: config.bkash_password,
					},
					body: JSON.stringify({
						app_key: config.bkash_app_key,
						app_secret: config.bkash_secret_key,
						refresh_token: bkashRefreshToken,
					}),
				},
			);

			if (!refreshTokenResponse.ok) {
				throw new AppError(httpStatus.BAD_GATEWAY, "Bkash access token grant failed");
			}
			const bkashRefreshTokenResult = await refreshTokenResponse.json();
			bkashIdToken = bkashRefreshTokenResult.id_token as string;
			await redisClient.set(IdToken, bkashIdToken, {
				expiration: {
					type: "EX",
					value: 60 * 60,
				},
			});

			return bkashIdToken;
		}

		if (bkashIdTokenTTL > 600) {
			return bkashIdToken;
		}

		const response = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/token/grant`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					username: config.bkash_username,
					password: config.bkash_password,
				},
				body: JSON.stringify({
					app_key: config.bkash_app_key,
					app_secret: config.bkash_secret_key,
				}),
			},
		);

		if (!response.ok) {
			throw new AppError(httpStatus.BAD_GATEWAY, "Bkash access token grant failed");
		}

		const result = await response.json();

		await redisClient.set(IdToken, result.id_token, {
			expiration: {
				type: "EX",
				value: 60 * 60,
			},
		});

		await redisClient.set(RefreshToken, result.refresh_token, {
			expiration: {
				type: "EX",
				value: 60 * 60 * 24 * 28,
			},
		});

		bkashIdToken = result.id_token;
		return bkashIdToken;
	} catch (error: any) {
		throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, error);
	}
};
